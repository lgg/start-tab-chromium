/** Countdown derives from monotonic elapsed time, not callback count. */
export function remainingCountdownSeconds(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** Use the full plural rules so a different configured delay or a delayed
 * callback remains localized correctly, including the Russian teen forms. */
export function countdownSecondUnitKey(locale: "en" | "ru", seconds: number): "secondOne" | "secondFew" | "secondMany" {
  if (locale === "en") return seconds === 1 ? "secondOne" : "secondMany";
  const mod10 = seconds % 10;
  const mod100 = seconds % 100;
  if (mod10 === 1 && mod100 !== 11) return "secondOne";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "secondFew";
  return "secondMany";
}
