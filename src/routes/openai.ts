import { Hono, type Context } from "hono";
import { scoreEligibility } from "../lib/eligibility";
import { encodeToToon, estimateTokens } from "../lib/encoder";
import { calcUsdSaved } from "../lib/pricing";
import { writeSavings } from "../lib/savings";

const openai = new Hono<{ Bindings: Env }>();

// Strips the /v1 prefix so it can be appended to UPSTREAM_URL (which already ends in /v1).
function upstreamPath(path: string): string {
  return path.replace(/^\/v1/, "");
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
    return forward(c, bodyText, endpoint);
  }

  const isStreaming = body.stream === true;
  const model = typeof body.model === "string" ? body.model : "unknown";
  const tokensBefore = estimateTokens(bodyText);
  let outBodyText = bodyText;
  let tokensAfter = tokensBefore;

  if (!isStreaming) {
    const messages = body.messages;
    if (Array.isArray(messages)) {
      const threshold = parseFloat(env.TOON_THRESHOLD);
      let modified = false;

      const processedMessages = messages.map((msg: unknown) => {
        const m = msg as Record<string, unknown>;
        if (scoreEligibility(m.content) >= threshold) {
          modified = true;
          return { ...m, content: encodeToToon(m.content) };
        }
        return m;
      });

      if (modified) {
        outBodyText = JSON.stringify({ ...body, messages: processedMessages });
        tokensAfter = estimateTokens(outBodyText);
      }
    }
  }

  const headers = new Headers(c.req.raw.headers);
  headers.set("Authorization", `Bearer ${env.OPENAI_API_KEY}`);
  headers.delete("content-length");

  // Forward Cloudflare AI Gateway auth if configured.
  // Normalise: accept bare token ("vck_...") or pre-formatted ("Bearer vck_...").
  if (env.CF_AIG_TOKEN) {
    const aigToken = env.CF_AIG_TOKEN.startsWith("Bearer ")
      ? env.CF_AIG_TOKEN
      : `Bearer ${env.CF_AIG_TOKEN}`;
    headers.set("cf-aig-authorization", aigToken);
  }
  // Forward any cf-aig-* headers from the original request
  for (const [key, value] of c.req.raw.headers.entries()) {
    if (key.startsWith("cf-aig-")) {
      headers.set(key, value);
    }
  }

  const upstream = env.UPSTREAM_URL + upstreamPath(c.req.path);
  const response = await fetch(
    new Request(upstream, { method: "POST", headers, body: outBodyText }),
  );

  const elapsed = Date.now() - start;
  const tokensSaved = Math.max(0, tokensBefore - tokensAfter);

  if (env.TOON_LOG_SAVINGS === "true") {
    writeSavings(
      env.DB,
      {
        ts: new Date().toISOString(),
        model,
        endpoint,
        tokens_before: tokensBefore,
        tokens_after: tokensAfter,
        tokens_saved: tokensSaved,
        usd_saved: calcUsdSaved(model, tokensSaved),
        elapsed_ms: elapsed,
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

async function forward(
  c: Context<{ Bindings: Env }>,
  body: string,
  endpoint: string,
): Promise<Response> {
  const env = c.env;
  const headers = new Headers(c.req.raw.headers);
  headers.set("Authorization", `Bearer ${env.OPENAI_API_KEY}`);
  headers.delete("content-length");

  // Forward Cloudflare AI Gateway auth if configured
  if (env.CF_AIG_TOKEN) {
    headers.set("cf-aig-authorization", env.CF_AIG_TOKEN);
  }

  const upstream = env.UPSTREAM_URL + upstreamPath(c.req.path);
  const response = await fetch(
    new Request(upstream, { method: "POST", headers, body }),
  );

  writeSavings(env.DB, {
    ts: new Date().toISOString(),
    model: "unknown",
    endpoint,
    tokens_before: 0,
    tokens_after: 0,
    tokens_saved: 0,
    usd_saved: 0,
    elapsed_ms: 0,
  });

  return new Response(response.body, {
    status: response.status,
    headers: new Headers(response.headers),
  });
}

openai.post("/v1/chat/completions", (c) => proxy(c, "/v1/chat/completions"));
openai.post("/v1/embeddings", (c) => proxy(c, "/v1/embeddings"));

export default openai;
