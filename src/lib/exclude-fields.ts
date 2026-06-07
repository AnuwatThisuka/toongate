export function parseExcludeFields(raw: string | undefined): Set<string> {
  if (!raw || raw.trim() === "") return new Set();
  return new Set(raw.split(",").map((f) => f.trim()).filter(Boolean));
}

export function stripExcludedFields(
  obj: Record<string, unknown>,
  exclude: Set<string>,
): Record<string, unknown> {
  if (exclude.size === 0) return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!exclude.has(k)) out[k] = v;
  }
  return out;
}

export function applyExcludeToArray(
  arr: unknown[],
  exclude: Set<string>,
): unknown[] {
  if (exclude.size === 0) return arr;
  return arr.map((item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? stripExcludedFields(item as Record<string, unknown>, exclude)
      : item,
  );
}
