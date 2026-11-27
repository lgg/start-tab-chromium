/** Format only tokens in the original pattern, never in localized output. */
export function formatDateParts(pattern: string, parts: Readonly<Record<string, string>>): string {
  const replacements = {
    dddd: parts.weekday ?? "",
    YYYY: parts.year ?? "",
    MMMM: parts.month ?? "",
    DD: parts.day ?? "",
    HH: parts.hour ?? "",
    mm: parts.minute ?? "",
    ss: parts.second ?? "",
  };
  return pattern.replace(/dddd|YYYY|MMMM|DD|HH|mm|ss/g, (token) => replacements[token as keyof typeof replacements]);
}

/** One formatter per mounted widget; a single parts extraction per tick. */
export function createDatePartsFormatter(locale: string, timeZone: string): (date: Date) => Record<string, string> {
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: timeZone || undefined,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return (date) => Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}
