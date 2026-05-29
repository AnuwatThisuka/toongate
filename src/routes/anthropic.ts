import { Hono, type Context } from "hono";
import { scoreEligibility } from "../lib/eligibility";
import { encodeToToon, estimateTokens } from "../lib/encoder";
import { decodeFromToon } from "../lib/decoder";
import { createSseDecodeStream } from "../lib/sse";
import { calcUsdSaved } from "../lib/pricing";
import { writeSavings } from "../lib/savings";

const anthropic = new Hono<{ Bindings: Env }>();

// Anthropic's API is at /v1/messages; UPSTREAM_URL already ends in /v1.
function upstreamPath(path: string): string {
  return path.replace(/^\/v1/, "");
}

function setAuthHeaders(headers: Headers, env: Env): void {
  headers.delete("authorization");
  headers.delete("x-api-key");
  headers.set("x-api-key", env.ANTHROPIC_API_KEY);
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

  // Encode request regardless of streaming — TOON compression is input-side only.
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
      const compressedBody = JSON.stringify({ ...body, messages: processedMessages });
      tokensAfter = estimateTokens(compressedBody);

      if (env.TOON_DRY_RUN === "true") {
        const saved = Math.max(0, tokensBefore - tokensAfter);
        console.log(
          `[TOON DRY-RUN] model=${model} endpoint=${endpoint}` +
          ` tokens_before=${tokensBefore} tokens_after=${tokensAfter}` +
          ` tokens_saved=${saved} usd_saved=${calcUsdSaved(model, saved).toFixed(6)}` +
          ` — payload NOT compressed`,
        );
      } else {
        outBodyText = compressedBody;
      }
    }
  }

  const headers = new Headers(c.req.raw.headers);
  setAuthHeaders(headers, env);
  headers.delete("content-length");

  // Forward Cloudflare AI Gateway auth if configured.
  // Normalize: accept bare token ("vck_...") or pre-formatted ("Bearer vck_...").
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
  respHeaders.set("x-toongate-compressed", tokensSaved > 0 ? "true" : "false");
  respHeaders.set("x-toongate-saved", `${tokensSaved} tokens`);

  if (isStreaming && response.body) {
    return new Response(response.body.pipeThrough(createSseDecodeStream()), {
      status: response.status,
      headers: respHeaders,
    });
  }

  // Non-streaming: decode any TOON in the response body before returning.
  const respText = await response.text();
  try {
    const respJson = JSON.parse(respText);
    const block = respJson?.content?.[0];
    if (block?.type === "text" && typeof block.text === "string") {
      block.text = decodeFromToon(block.text);
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

async function forward(
  c: Context<{ Bindings: Env }>,
  body: string,
  endpoint: string,
): Promise<Response> {
  const env = c.env;
  const headers = new Headers(c.req.raw.headers);
  setAuthHeaders(headers, env);
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

anthropic.post("/v1/messages", (c) => proxy(c, "/v1/messages"));

export default anthropic;
