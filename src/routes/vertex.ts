import { Hono, type Context } from "hono";
import { deepCompressBody } from "../lib/deep-compress";
import { decodeFromToon } from "../lib/decoder";
import { applyDebugHeaders } from "../lib/headers";
import { estimateTokens } from "../lib/encoder";
import { calcUsdSaved } from "../lib/pricing";
import { writeSavings } from "../lib/savings";
import { pushWebhook } from "../lib/webhook";
import { fetchWithRetry } from "../lib/retry";
import { createSseDecodeStream } from "../lib/sse";
import { resolveThreshold } from "../lib/threshold";
import { parseExcludeFields } from "../lib/exclude-fields";
import { isCircuitOpen, recordOutcome } from "../lib/circuit-breaker";
import { getAdaptiveThreshold } from "../lib/adaptive-threshold";

const vertex = new Hono<{ Bindings: Env }>();

const DEFAULT_LOCATION = "us-central1";

function buildUpstreamUrl(endpoint: string, env: Env): string {
  const project = env.VERTEX_PROJECT;
  const location = env.VERTEX_LOCATION || DEFAULT_LOCATION;
  const base = `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${project}/locations/${location}/endpoints/openapi`;
  // Strip /vertex prefix → /v1/chat/completions or /v1/embeddings
  const path = endpoint.replace(/^\/vertex/, "");
  return base + path;
}

function buildUpstreamHeaders(c: Context<{ Bindings: Env }>): Headers {
  const headers = new Headers(c.req.raw.headers);
  headers.delete("authorization");
  headers.set("Authorization", `Bearer ${c.env.VERTEX_ACCESS_TOKEN}`);
  headers.delete("content-length");
  headers.delete("x-toongate-admin-key");
  headers.delete("x-toongate-mode");
  headers.delete("x-compression-level");
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

  if (!env.VERTEX_PROJECT || !env.VERTEX_ACCESS_TOKEN) {
    return c.json({ error: "Vertex AI is not configured (VERTEX_PROJECT and VERTEX_ACCESS_TOKEN required)" }, 503);
  }

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

  if (isCircuitOpen()) {
    return fetchUpstream(c, bodyText, endpoint, start);
  }

  const excludeFields = parseExcludeFields(env.TOON_EXCLUDE_FIELDS);
  const adaptiveBase = env.TOON_THRESHOLD_AUTO === "true" && env.DB
    ? await getAdaptiveThreshold(env.DB, parseFloat(env.TOON_THRESHOLD ?? "0.6"))
    : undefined;
  const threshold = resolveThreshold(env, endpoint, adaptiveBase);
  const originalTokensBefore = estimateTokens(bodyText);

  const result = deepCompressBody(body, threshold, excludeFields);
  const outBodyText = env.TOON_DRY_RUN === "true" ? bodyText : result.bodyText;
  const totalTokensSaved = Math.max(0, originalTokensBefore - result.tokensAfter);

  const upstreamUrl = buildUpstreamUrl(endpoint, env);

  let response: Response;
  try {
    response = await fetchWithRetry(
      upstreamUrl,
      { method: "POST", headers: buildUpstreamHeaders(c), body: outBodyText },
      getTimeout(env),
    );
  } catch (err) {
    recordOutcome(false);
    if (err instanceof Error && err.name === "AbortError") {
      return c.json({ error: "upstream timeout" }, 504);
    }
    return c.json({ error: "upstream error" }, 502);
  }

  recordOutcome(response.ok);

  const elapsed = Date.now() - start;
  const savingsRow = {
    ts: new Date().toISOString(),
    model,
    endpoint,
    tokens_before: originalTokensBefore,
    tokens_after: result.tokensAfter,
    tokens_saved: totalTokensSaved,
    usd_saved: calcUsdSaved(model, totalTokensSaved),
    elapsed_ms: elapsed,
    deep_compressed: "deepCompressed" in result && result.deepCompressed ? 1 : 0,
  };
  if (env.TOON_LOG_SAVINGS === "true" && env.DB) {
    writeSavings(env.DB, savingsRow, c.executionCtx);
  }
  if (env.SAVINGS_WEBHOOK_URL) {
    pushWebhook(env.SAVINGS_WEBHOOK_URL, savingsRow, c.executionCtx);
  }

  const respHeaders = new Headers(response.headers);
  respHeaders.delete("content-encoding");
  applyDebugHeaders(respHeaders, result, {
    tokensBefore: originalTokensBefore,
    tokensAfter: result.tokensAfter,
    tokensSaved: totalTokensSaved,
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
    return new Response(JSON.stringify(respJson), { status: response.status, headers: respHeaders });
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

  let response: Response;
  try {
    response = await fetchWithRetry(
      upstreamUrl,
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
    writeSavings(env.DB, {
      ts: new Date().toISOString(), model: "unknown", endpoint,
      tokens_before: 0, tokens_after: 0, tokens_saved: 0, usd_saved: 0,
      elapsed_ms: Date.now() - start,
    }, c.executionCtx);
  }

  const respHeaders = new Headers(response.headers);
  respHeaders.delete("content-encoding");
  return new Response(response.body, { status: response.status, headers: respHeaders });
}

vertex.post("/vertex/v1/chat/completions", (c) => proxy(c, "/vertex/v1/chat/completions"));
vertex.post("/vertex/v1/embeddings", (c) => proxy(c, "/vertex/v1/embeddings"));

export default vertex;
