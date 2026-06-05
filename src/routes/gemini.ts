import { Hono, type Context } from "hono";
import { applyCavemanMode, isCavemanMode } from "../lib/caveman";
import { compressRequestBody } from "../lib/compress";
import { decodeFromToon } from "../lib/decoder";
import { applyDebugHeaders } from "../lib/headers";
import { estimateTokens } from "../lib/encoder";
import { calcUsdSaved } from "../lib/pricing";
import { writeSavings } from "../lib/savings";
import { createSseDecodeStream } from "../lib/sse";
import { resolveThreshold } from "../lib/threshold";

const gemini = new Hono<{ Bindings: Env }>();

/**
 * Default upstream for Gemini's OpenAI-compatible endpoint.
 * Override via GEMINI_UPSTREAM_URL for Vertex AI or other deployments:
 *   https://us-central1-aiplatform.googleapis.com/v1/projects/{project}/locations/us-central1/endpoints/openapi
 */
const GEMINI_DEFAULT_UPSTREAM = "https://generativelanguage.googleapis.com/v1beta/openai";

function buildUpstreamUrl(endpoint: string, env: Env): string {
  const base = (env.GEMINI_UPSTREAM_URL || GEMINI_DEFAULT_UPSTREAM).replace(/\/$/, "");
  // Strip /gemini prefix → /v1/chat/completions or /v1/embeddings
  const path = endpoint.replace(/^\/gemini/, "");
  return base + path;
}

function buildUpstreamHeaders(c: Context<{ Bindings: Env }>): Headers {
  const headers = new Headers(c.req.raw.headers);
  headers.delete("authorization");
  headers.set("Authorization", `Bearer ${c.env.GEMINI_API_KEY}`);
  headers.delete("content-length");
  // Strip toongate-internal headers — never forward to upstream
  headers.delete("x-toongate-admin-key");
  headers.delete("x-toongate-mode");
  headers.delete("x-compression-level");

  if (c.env.CF_AIG_TOKEN) {
    const tok = c.env.CF_AIG_TOKEN.startsWith("Bearer ")
      ? c.env.CF_AIG_TOKEN
      : `Bearer ${c.env.CF_AIG_TOKEN}`;
    headers.set("cf-aig-authorization", tok);
  }
  for (const [k, v] of c.req.raw.headers.entries()) {
    if (k.startsWith("cf-aig-")) headers.set(k, v);
  }
  return headers;
}

function getTimeout(env: Env): number {
  const ms = parseInt(env.UPSTREAM_TIMEOUT_MS ?? "30000", 10);
  return isNaN(ms) ? 30000 : ms;
}

async function proxy(
  c: Context<{ Bindings: Env }>,
  endpoint: string,
): Promise<Response> {
  if (!c.env.GEMINI_API_KEY && !c.env.GEMINI_UPSTREAM_URL) {
    return c.json({ error: "Gemini is not configured" }, 503);
  }

  const env = c.env;
  const start = Date.now();
  const bodyText = await c.req.text();

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    return fetchUpstream(c, bodyText, endpoint, start);
  }

  const isStreaming = body.stream === true;
  const model = typeof body.model === "string" ? body.model : "unknown";
  const threshold = resolveThreshold(env, endpoint);
  const originalTokensBefore = estimateTokens(bodyText);

  const caveman = isCavemanMode(c.req.raw.headers)
    ? applyCavemanMode(body)
    : { body, activated: false };
  const processedBody = caveman.body;
  const processedText = caveman.activated
    ? JSON.stringify(processedBody)
    : bodyText;

  const result = compressRequestBody(processedBody, processedText, threshold);
  const outBodyText = env.TOON_DRY_RUN === "true" ? bodyText : result.bodyText;

  const totalTokensSaved = Math.max(0, originalTokensBefore - result.tokensAfter);

  if (env.TOON_DRY_RUN === "true" && result.compressed) {
    console.log(
      `[TOON DRY-RUN] provider=gemini model=${model} endpoint=${endpoint}` +
        ` tokens_before=${originalTokensBefore} tokens_after=${result.tokensAfter}` +
        ` tokens_saved=${totalTokensSaved}` +
        ` caveman=${caveman.activated}` +
        ` usd_saved=${calcUsdSaved(model, totalTokensSaved).toFixed(6)}` +
        ` — payload NOT compressed`,
    );
  }

  const upstreamUrl = buildUpstreamUrl(endpoint, env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeout(env));

  let response: Response;
  try {
    response = await fetch(
      new Request(upstreamUrl, {
        method: "POST",
        headers: buildUpstreamHeaders(c),
        body: outBodyText,
        signal: controller.signal,
      }),
    );
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      return c.json({ error: "upstream timeout" }, 504);
    }
    return c.json({ error: "upstream error" }, 502);
  }
  clearTimeout(timer);

  const elapsed = Date.now() - start;

  if (env.TOON_LOG_SAVINGS === "true" && env.DB) {
    writeSavings(
      env.DB,
      {
        ts: new Date().toISOString(),
        model,
        endpoint,
        tokens_before: originalTokensBefore,
        tokens_after: result.tokensAfter,
        tokens_saved: totalTokensSaved,
        usd_saved: calcUsdSaved(model, totalTokensSaved),
        elapsed_ms: elapsed,
        caveman_mode: caveman.activated ? 1 : 0,
      },
      c.executionCtx,
    );
  }

  const respHeaders = new Headers(response.headers);
  respHeaders.delete("content-encoding");
  applyDebugHeaders(respHeaders, result, {
    tokensBefore: originalTokensBefore,
    tokensAfter: result.tokensAfter,
    tokensSaved: totalTokensSaved,
    cavemanMode: caveman.activated,
  });

  if (isStreaming && response.body) {
    return new Response(response.body.pipeThrough(createSseDecodeStream()), {
      status: response.status,
      headers: respHeaders,
    });
  }

  const respText = await response.text();
  try {
    const respJson = JSON.parse(respText);
    if (Array.isArray(respJson?.choices)) {
      for (const choice of respJson.choices) {
        const content = choice?.message?.content;
        if (typeof content === "string") {
          const decoded = decodeFromToon(content);
          choice.message.content = typeof decoded === "string" ? decoded : content;
        }
      }
    }
    return new Response(JSON.stringify(respJson), {
      status: response.status,
      headers: respHeaders,
    });
  } catch {
    return new Response(respText, { status: response.status, headers: respHeaders });
  }
}

async function fetchUpstream(
  c: Context<{ Bindings: Env }>,
  body: string,
  endpoint: string,
  start: number,
): Promise<Response> {
  const env = c.env;
  const upstreamUrl = buildUpstreamUrl(endpoint, env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeout(env));

  let response: Response;
  try {
    response = await fetch(
      new Request(upstreamUrl, {
        method: "POST",
        headers: buildUpstreamHeaders(c),
        body,
        signal: controller.signal,
      }),
    );
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      return c.json({ error: "upstream timeout" }, 504);
    }
    return c.json({ error: "upstream error" }, 502);
  }
  clearTimeout(timer);

  if (env.TOON_LOG_SAVINGS === "true" && env.DB) {
    writeSavings(
      env.DB,
      {
        ts: new Date().toISOString(),
        model: "unknown",
        endpoint,
        tokens_before: 0,
        tokens_after: 0,
        tokens_saved: 0,
        usd_saved: 0,
        elapsed_ms: Date.now() - start,
      },
      c.executionCtx,
    );
  }

  const respHeaders = new Headers(response.headers);
  respHeaders.delete("content-encoding");
  return new Response(response.body, {
    status: response.status,
    headers: respHeaders,
  });
}

gemini.post("/gemini/v1/chat/completions", (c) =>
  proxy(c, "/gemini/v1/chat/completions"),
);
gemini.post("/gemini/v1/embeddings", (c) =>
  proxy(c, "/gemini/v1/embeddings"),
);

export default gemini;
