export function validDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T12:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** A provider date-time must have a real calendar date and an ISO time.
 * A date-only value belongs to the distinct all-day representation. */
export function validCalendarDateTime(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/i.test(value)
    && validDateOnly(value.slice(0, 10))
    && Number(value.slice(11, 13)) < 24
    && Number(value.slice(14, 16)) < 60
    && Number(value.slice(17, 19)) < 60
    && Number.isFinite(Date.parse(value));
}
