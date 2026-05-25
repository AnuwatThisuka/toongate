const MODEL_PRICES: Record<string, number> = {
  "gpt-4o": 2.5,
  "gpt-4o-mini": 0.15,
  "gpt-4-turbo": 10.0,
  "claude-opus-4": 15.0,
  "claude-sonnet-4-5": 3.0,
  "claude-haiku-4-5": 0.8,
};

const DEFAULT_PRICE = 2.5;

export function calcUsdSaved(model: string, tokensSaved: number): number {
  const pricePerMillion = MODEL_PRICES[model] ?? DEFAULT_PRICE;
  return (tokensSaved / 1_000_000) * pricePerMillion;
}
