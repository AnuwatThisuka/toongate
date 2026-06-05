import type { CompressResult } from "./compress";
import type { DeepCompressResult } from "./deep-compress";

export interface DebugOverrides {
  tokensBefore?: number;
  tokensAfter?: number;
  tokensSaved?: number;
  cavemanMode?: boolean;
}

export function applyDebugHeaders(
  headers: Headers,
  result: CompressResult | DeepCompressResult,
  overrides: DebugOverrides = {},
): void {
  const tokensBefore = overrides.tokensBefore ?? result.tokensBefore;
  const tokensAfter = overrides.tokensAfter ?? result.tokensAfter;
  const tokensSaved = overrides.tokensSaved ?? result.tokensSaved;

  headers.set("x-toongate-compressed", result.compressed ? "true" : "false");
  headers.set("x-toongate-tokens-before", String(tokensBefore));
  headers.set("x-toongate-tokens-after", String(tokensAfter));
  headers.set("x-toongate-tokens-saved", String(tokensSaved));
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
  if (overrides.cavemanMode !== undefined) {
    headers.set("x-toongate-caveman-mode", overrides.cavemanMode ? "true" : "false");
  }
}
