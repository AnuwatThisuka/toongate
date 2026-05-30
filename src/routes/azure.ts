import { Hono, type Context } from "hono";
import { compressRequestBody } from "../lib/compress";
import { decodeFromToon } from "../lib/decoder";
import { applyDebugHeaders } from "../lib/headers";
import { calcUsdSaved } from "../lib/pricing";
import { writeSavings } from "../lib/savings";
import { createSseDecodeStream } from "../lib/sse";
import { resolveThreshold } from "../lib/threshold";

const azure = new Hono<{ Bindings: Env }>();

const AZURE_API_VERSION_DEFAULT = "2024-02-01";

/** Map toongate endpoint path → Azure REST resource segment */
const AZURE_RESOURCE: Record<string, string> = {
  "/azure/v1/chat/completions": "chat/completions",
  "/azure/v1/embeddings": "embeddings",
};

function buildUpstreamUrl(endpoint: string, model: string, env: Env): string {
  const base = env.AZURE_OPENAI_ENDPOINT.replace(/\/$/, "");
  const apiVersion = env.AZURE_OPENAI_API_VERSION || AZURE_API_VERSION_DEFAULT;
  const resource = AZURE_RESOURCE[endpoint] ?? "chat/completions";
  return `${base}/openai/deployments/${encodeURIComponent(model)}/${resource}?api-version=${apiVersion}`;
}

function buildUpstreamHeaders(c: Context<{ Bindings: Env }>): Headers {
  const headers = new Headers(c.req.raw.headers);
  // Azure uses api-key header, not Authorization Bearer
  headers.delete("authorization");
  headers.set("api-key", c.env.AZURE_OPENAI_API_KEY);
  headers.delete("content-length");
  // Strip toongate-internal headers — never forward to upstream
  headers.delete("x-toongate-admin-key");

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
  if (!c.env.AZURE_OPENAI_ENDPOINT || !c.env.AZURE_OPENAI_API_KEY) {
    return c.json({ error: "Azure OpenAI is not configured" }, 503);
  }

  const env = c.env;
  const start = Date.now();
  const bodyText = await c.req.text();

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    return fetchUpstream(c, bodyText, endpoint, "unknown", start);
  }

  const isStreaming = body.stream === true;
  const model = typeof body.model === "string" ? body.model : "unknown";
  const threshold = resolveThreshold(env, endpoint);

  const result = compressRequestBody(body, bodyText, threshold);
  const outBodyText = env.TOON_DRY_RUN === "true" ? bodyText : result.bodyText;

  if (env.TOON_DRY_RUN === "true" && result.compressed) {
    console.log(
      `[TOON DRY-RUN] provider=azure model=${model} endpoint=${endpoint}` +
        ` tokens_before=${result.tokensBefore} tokens_after=${result.tokensAfter}` +
        ` tokens_saved=${result.tokensSaved}` +
        ` usd_saved=${calcUsdSaved(model, result.tokensSaved).toFixed(6)}` +
        ` — payload NOT compressed`,
    );
  }

  const upstreamUrl = buildUpstreamUrl(endpoint, model, env);
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
        tokens_before: result.tokensBefore,
        tokens_after: result.tokensAfter,
        tokens_saved: result.tokensSaved,
        usd_saved: calcUsdSaved(model, result.tokensSaved),
        elapsed_ms: elapsed,
      },
      c.executionCtx,
    );
  }

  const respHeaders = new Headers(response.headers);
  respHeaders.delete("content-encoding");
  applyDebugHeaders(respHeaders, result);

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
  model: string,
  start: number,
): Promise<Response> {
  const env = c.env;
  const upstreamUrl = buildUpstreamUrl(endpoint, model, env);
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

azure.post("/azure/v1/chat/completions", (c) =>
  proxy(c, "/azure/v1/chat/completions"),
);
azure.post("/azure/v1/embeddings", (c) =>
  proxy(c, "/azure/v1/embeddings"),
);

export default azure;
