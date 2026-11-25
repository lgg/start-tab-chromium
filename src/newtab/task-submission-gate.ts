/** Keep an in-flight Add Task action from duplicating an entry or clearing
 * the next draft the user typed while the worker acknowledged the first one. */
export class TaskSubmissionGate {
  private active = false;

  get pending(): boolean { return this.active; }

  begin(): boolean {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  afterSuccess(currentDraft: string, submittedDraft: string): string {
    return currentDraft === submittedDraft ? "" : currentDraft;
  }

  finish(): void { this.active = false; }
}
