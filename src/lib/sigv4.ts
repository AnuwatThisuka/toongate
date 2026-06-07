// SigV4 signing using the Web Crypto API (available in CF Workers).

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(data: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(data)));
}

async function hmacSha256(key: ArrayBuffer | string, data: string): Promise<ArrayBuffer> {
  const raw = typeof key === "string" ? enc.encode(key) : key;
  const k = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

export interface SigV4Options {
  method: string;
  url: string;
  body: string;
  service: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  contentType?: string;
}

export async function signV4(opts: SigV4Options): Promise<Record<string, string>> {
  const { method, url, body, service, region, accessKeyId, secretAccessKey, sessionToken, contentType = "application/json" } = opts;
  const parsed = new URL(url);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const datestamp = amzDate.slice(0, 8);

  const payloadHash = await sha256Hex(body);

  const signedHeaderNames = ["content-type", "host", "x-amz-date", "x-amz-content-sha256"];
  if (sessionToken) signedHeaderNames.push("x-amz-security-token");
  signedHeaderNames.sort();

  const headerValues: Record<string, string> = {
    "content-type": contentType,
    "host": parsed.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
  };
  if (sessionToken) headerValues["x-amz-security-token"] = sessionToken;

  const canonicalHeaders = signedHeaderNames.map((k) => `${k}:${headerValues[k]}`).join("\n") + "\n";
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalQuery = [...parsed.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const canonicalRequest = [method, parsed.pathname, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const credScope = `${datestamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credScope, await sha256Hex(canonicalRequest)].join("\n");

  const kDate = await hmacSha256("AWS4" + secretAccessKey, datestamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const result: Record<string, string> = {
    Authorization: authHeader,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
  };
  if (sessionToken) result["x-amz-security-token"] = sessionToken;
  return result;
}
