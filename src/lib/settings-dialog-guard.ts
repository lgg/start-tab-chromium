const OPEN_SETTINGS_DIALOG_SELECTOR = "dialog.settings-dialog[open]";
const FOCUSABLE_SELECTOR = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
let dialogSequence = 0;

export function nextSettingsDialogTitleId(prefix: string): string {
  dialogSequence += 1;
  return `${prefix}-${Date.now()}-${dialogSequence}`;
}

export function focusExistingSettingsDialog(): boolean {
  const dialog = document.querySelector<HTMLDialogElement>(OPEN_SETTINGS_DIALOG_SELECTOR);
  if (!dialog) return false;
  const target = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? dialog;
  target.focus();
  return true;
}

/** A dirty editor must also be protected when the user reloads or closes
 * the browser tab, not just when they press a button in the dialog. */
export function protectSettingsDialogDraft(dialog: HTMLDialogElement, isDirty: () => boolean): void {
  const beforeUnload = (event: BeforeUnloadEvent): void => {
    if (!dialog.open || !isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", beforeUnload);
  dialog.addEventListener("close", () => {
    window.removeEventListener("beforeunload", beforeUnload);
  }, { once: true });
}
