/**
 * Create and read dictionaries whose keys may originate from user data.
 *
 * Plain JavaScript objects inherit special names such as `constructor` and
 * *also* expose the legacy `__proto__` setter. A block ID or domain using one
 * of those names must remain ordinary data instead of reading/mutating the
 * object prototype.
 */
export function createDictionary<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export function ownValue<T>(
  record: Readonly<Record<string, T>> | null | undefined,
  key: string,
): T | undefined {
  return record && Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

export function cloneDictionary<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  const clone = createDictionary<T>();
  for (const [key, value] of Object.entries(record)) clone[key] = structuredClone(value);
  return clone;
}
