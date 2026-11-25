/** The timeout signal remains attached to the response body as well as headers. */
export async function fetchWidgetJson(url: string, timeoutMs = 8_000): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error("Widget provider returned " + response.status);
  return response.json();
}
