export function scoreEligibility(value: unknown): number {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return 0.0;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return 0.0;

    const allObjects = value.every(
      (item): item is Record<string, unknown> =>
        item !== null && typeof item === "object" && !Array.isArray(item)
    );
    if (!allObjects) return 0.5;

    const referenceKeys = Object.keys(
      value[0] as Record<string, unknown>
    )
      .sort()
      .join("\0");

    const uniformKeys = value.every(
      (item) =>
        Object.keys(item as Record<string, unknown>)
          .sort()
          .join("\0") === referenceKeys
    );

    return uniformKeys ? 1.0 : 0.5;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return 0.0;

  let total = 0;
  for (const k of keys) {
    total += scoreEligibility(obj[k]);
  }
  return total / keys.length;
}
