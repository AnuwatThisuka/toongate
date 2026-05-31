import type { CompressResult } from "./compress";
import type { DeepCompressResult } from "./deep-compress";

export function applyDebugHeaders(
  headers: Headers,
  result: CompressResult | DeepCompressResult,
): void {
  headers.set("x-toongate-compressed", result.compressed ? "true" : "false");
  headers.set("x-toongate-tokens-before", String(result.tokensBefore));
  headers.set("x-toongate-tokens-after", String(result.tokensAfter));
  headers.set("x-toongate-tokens-saved", String(result.tokensSaved));
  headers.set(
    "x-toongate-eligibility-score",
    result.eligibilityScore.toFixed(2),
  );
  if ("deepCompressed" in result) {
    headers.set(
      "x-toongate-deep-compressed",
      result.deepCompressed ? "true" : "false",
    );
  }
}
