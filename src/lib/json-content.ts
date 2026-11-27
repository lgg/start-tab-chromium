/**
 * Canonicalize JSON-compatible values without changing array order.
 * Object key insertion order is not user data and must not create false
 * storage migrations or optimistic-concurrency conflicts.
 */
export function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, canonicalJsonValue(child)]),
  );
}

export function jsonContentEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJsonValue(left)) === JSON.stringify(canonicalJsonValue(right));
}
