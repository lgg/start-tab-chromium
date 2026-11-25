import type { LocalTask } from "../lib/start-page-types.js";
import { VersionedWidgetValue } from "./versioned-widget-value.js";

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

/** A task form's input and outstanding submission survive DOM replacement. */
export class TaskFormSession extends TaskSubmissionGate {
  readonly committed = new VersionedWidgetValue<LocalTask[]>();
  draft = "";
  view: (() => void) | undefined;
  acknowledge(submittedDraft: string): void {
    this.draft = this.afterSuccess(this.draft, submittedDraft);
  }
}

export class TaskFormSessions {
  private readonly sessions = new Map<string, TaskFormSession>();
  get(id: string): TaskFormSession {
    let session = this.sessions.get(id);
    if (!session) {
      session = new TaskFormSession();
      this.sessions.set(id, session);
    }
    return session;
  }
  prune(retained: ReadonlySet<string>): void {
    for (const [id, session] of this.sessions) {
      if (!retained.has(id) && !session.pending) this.sessions.delete(id);
    }
  }
}
