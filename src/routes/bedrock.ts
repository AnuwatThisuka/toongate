import { Hono, type Context } from "hono";
import { deepCompressBody } from "../lib/deep-compress";
import { decodeFromToon } from "../lib/decoder";
import { applyDebugHeaders } from "../lib/headers";
import { estimateTokens } from "../lib/encoder";
import { calcUsdSaved } from "../lib/pricing";
import { writeSavings } from "../lib/savings";
import { pushWebhook } from "../lib/webhook";
import { fetchWithRetry } from "../lib/retry";
import { resolveThreshold } from "../lib/threshold";
import { parseExcludeFields } from "../lib/exclude-fields";
import { isCircuitOpen, recordOutcome } from "../lib/circuit-breaker";
import { getAdaptiveThreshold } from "../lib/adaptive-threshold";
import { signV4 } from "../lib/sigv4";

const bedrock = new Hono<{ Bindings: Env }>();

const BEDROCK_SERVICE = "bedrock";
const DEFAULT_REGION = "us-east-1";
const ENDPOINT = "/bedrock/v1/messages";

function getRegion(env: Env): string {
  return env.AWS_REGION || DEFAULT_REGION;
}

function getTimeout(env: Env): number {
  const ms = parseInt(env.UPSTREAM_TIMEOUT_MS ?? "30000", 10);
  return isNaN(ms) ? 30000 : ms;
}

function buildBedrockUrl(modelId: string, region: string): string {
  return `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/invoke`;
}

async function proxy(c: Context<{ Bindings: Env }>): Promise<Response> {
  const env = c.env;

  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    return c.json({ error: "AWS Bedrock is not configured" }, 503);
  }

  const start = Date.now();
  const bodyText = await c.req.text();

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const model = typeof body.model === "string" ? body.model : "";
  if (!model) return c.json({ error: "model is required" }, 400);

  const region = getRegion(env);

  if (isCircuitOpen()) {
    const url = buildBedrockUrl(model, region);
    const bedrockBody: Record<string, unknown> = { ...body, anthropic_version: "bedrock-2023-05-31" };
    delete bedrockBody["model"];
    const rawBody = JSON.stringify(bedrockBody);
    const sigHeaders = await signV4({
      method: "POST", url, body: rawBody,
      service: BEDROCK_SERVICE, region,
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      sessionToken: env.AWS_SESSION_TOKEN,
    });
    return fetchWithRetry(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...sigHeaders },
      body: rawBody,
    }, getTimeout(env))
      .then((r) => new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } }))
      .catch(() => c.json({ error: "upstream error" }, 502));
  }

  const excludeFields = parseExcludeFields(env.TOON_EXCLUDE_FIELDS);
  const adaptiveBase = env.TOON_THRESHOLD_AUTO === "true" && env.DB
    ? await getAdaptiveThreshold(env.DB, parseFloat(env.TOON_THRESHOLD ?? "0.6"))
    : undefined;
  const threshold = resolveThreshold(env, ENDPOINT, adaptiveBase);
  const originalTokensBefore = estimateTokens(bodyText);

  const result = deepCompressBody(body, threshold, excludeFields);
  const compressedBody = env.TOON_DRY_RUN === "true" ? body : result.body as Record<string, unknown>;
  const totalTokensSaved = Math.max(0, originalTokensBefore - result.tokensAfter);

  // Map to Bedrock Anthropic format: add anthropic_version, remove model field
  const bedrockBody: Record<string, unknown> = { ...compressedBody, anthropic_version: "bedrock-2023-05-31" };
  delete bedrockBody.model;
  const outBodyText = JSON.stringify(bedrockBody);

  const url = buildBedrockUrl(model, region);
  const sigHeaders = await signV4({
    method: "POST", url, body: outBodyText,
    service: BEDROCK_SERVICE, region,
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
  });

  let response: Response;
  try {
    response = await fetchWithRetry(
      url,
      { method: "POST", headers: { "content-type": "application/json", ...sigHeaders }, body: outBodyText },
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
    endpoint: ENDPOINT,
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

  const respText = await response.text();
  try {
    const respJson = JSON.parse(respText);
    if (Array.isArray(respJson?.content)) {
      for (const block of respJson.content) {
        if (block?.type === "text" && typeof block.text === "string") {
          const decoded = decodeFromToon(block.text);
          block.text = typeof decoded === "string" ? decoded : block.text;
        }
      }
    }
    return new Response(JSON.stringify(respJson), { status: response.status, headers: respHeaders });
  } catch {
    return new Response(respText, { status: response.status, headers: respHeaders });
  }
}

bedrock.post("/bedrock/v1/messages", proxy);

export default bedrock;
