/** Countdown derives from monotonic elapsed time, not callback count. */
export function remainingCountdownSeconds(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
