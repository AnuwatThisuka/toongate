import { Hono, type Context } from "hono";
import { applyCavemanMode, isCavemanMode } from "../lib/caveman";
import { deepCompressBody } from "../lib/deep-compress";
import { decodeFromToon } from "../lib/decoder";
import { applyDebugHeaders } from "../lib/headers";
import { estimateTokens } from "../lib/encoder";
import { calcUsdSaved } from "../lib/pricing";
import { writeSavings } from "../lib/savings";
import { createSseDecodeStream } from "../lib/sse";
import { fetchWithRetry } from "../lib/retry";
import { resolveThreshold } from "../lib/threshold";

const openai = new Hono<{ Bindings: Env }>();

function upstreamPath(path: string): string {
  return path.replace(/^\/v1/, "");
}

function buildUpstreamHeaders(c: Context<{ Bindings: Env }>): Headers {
  const headers = new Headers(c.req.raw.headers);
  headers.set("Authorization", `Bearer ${c.env.OPENAI_API_KEY}`);
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

  const result = deepCompressBody(processedBody, threshold);
  const outBodyText = env.TOON_DRY_RUN === "true" ? bodyText : result.bodyText;

  const totalTokensSaved = Math.max(0, originalTokensBefore - result.tokensAfter);

  if (env.TOON_DRY_RUN === "true" && result.compressed) {
    console.log(
      `[TOON DRY-RUN] model=${model} endpoint=${endpoint}` +
        ` tokens_before=${originalTokensBefore} tokens_after=${result.tokensAfter}` +
        ` tokens_saved=${totalTokensSaved}` +
        ` caveman=${caveman.activated}` +
        ` usd_saved=${calcUsdSaved(model, totalTokensSaved).toFixed(6)}` +
        ` — payload NOT compressed`,
    );
  }

  let response: Response;
  try {
    response = await fetchWithRetry(
      env.UPSTREAM_URL + upstreamPath(c.req.path),
      { method: "POST", headers: buildUpstreamHeaders(c), body: outBodyText },
      getTimeout(env),
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return c.json({ error: "upstream timeout" }, 504);
    }
    return c.json({ error: "upstream error" }, 502);
  }

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
        deep_compressed: "deepCompressed" in result && result.deepCompressed ? 1 : 0,
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
          choice.message.content =
            typeof decoded === "string" ? decoded : content;
        }
      }
    }
    return new Response(JSON.stringify(respJson), {
      status: response.status,
      headers: respHeaders,
    });
  } catch {
    return new Response(respText, {
      status: response.status,
      headers: respHeaders,
    });
  }
}

async function fetchUpstream(
  c: Context<{ Bindings: Env }>,
  body: string,
  endpoint: string,
  start: number,
): Promise<Response> {
  const env = c.env;
  let response: Response;
  try {
    response = await fetchWithRetry(
      env.UPSTREAM_URL + upstreamPath(c.req.path),
      { method: "POST", headers: buildUpstreamHeaders(c), body },
      getTimeout(env),
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return c.json({ error: "upstream timeout" }, 504);
    }
    return c.json({ error: "upstream error" }, 502);
  }

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

openai.post("/v1/chat/completions", (c) => proxy(c, "/v1/chat/completions"));
openai.post("/v1/embeddings", (c) => proxy(c, "/v1/embeddings"));

export default openai;
