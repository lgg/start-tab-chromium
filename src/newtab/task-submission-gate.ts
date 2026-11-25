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

export interface TaskDraftSnapshot {
  readonly value: string;
  readonly generation: number;
}

/** A task form's input and outstanding submission survive DOM replacement.
 * A value-only comparison cannot distinguish editing away from and back to
 * the submitted text while a save is pending. */
export class TaskFormSession extends TaskSubmissionGate {
  readonly committed = new VersionedWidgetValue<LocalTask[]>();
  private draftValue = "";
  private draftGeneration = 0;
  view: (() => void) | undefined;

  get draft(): string { return this.draftValue; }
  set draft(value: string) {
    if (value === this.draftValue) return;
    this.draftValue = value;
    this.draftGeneration++;
  }

  snapshotDraft(): TaskDraftSnapshot {
    return { value: this.draftValue, generation: this.draftGeneration };
  }

  acknowledge(submittedDraft: TaskDraftSnapshot): void {
    if (submittedDraft.generation !== this.draftGeneration) return;
    if (submittedDraft.value !== this.draftValue) return;
    this.draft = "";
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
  hasPendingDrafts(): boolean {
    return [...this.sessions.values()].some((session) => session.pending || session.draft.length > 0);
  }
  prune(retained: ReadonlySet<string>): void {
    for (const [id, session] of this.sessions) {
      if (!retained.has(id) && !session.pending) this.sessions.delete(id);
    }
  }
}
