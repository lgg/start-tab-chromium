/** Tracks the original displayed form, not whichever settings snapshot was
 * most recently loaded by another action. A failed save never clears a draft. */
export class GeneralFormDraft {
  private baseline: string;
  constructor(initial: string) { this.baseline = initial; }
  isDirty(current: string): boolean { return current !== this.baseline; }
  acknowledge(current: string): void { this.baseline = current; }
  mayReplace(current: string, confirmDiscard: () => boolean): boolean {
    return !this.isDirty(current) || confirmDiscard();
  }
}
