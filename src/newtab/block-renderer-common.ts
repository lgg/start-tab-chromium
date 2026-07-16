export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export function actionButton(
  text: string,
  action: () => void | Promise<void>,
  className = "button",
  onError?: (error: unknown) => void,
): HTMLButtonElement {
  const button = element("button", className, text);
  button.type = "button";
  button.addEventListener("click", () => {
    void Promise.resolve().then(action).catch((error: unknown) => onError?.(error));
  });
  return button;
}

export function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatDuration(milliseconds: number, includeHours = true): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = includeHours || hours > 0
    ? [hours, minutes, seconds]
    : [minutes, seconds];
  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}
