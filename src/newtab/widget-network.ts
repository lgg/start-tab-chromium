/** IP, weather and geocoding responses are small. Bound the decoded response
 * bytes before JSON parsing; a custom provider may omit or lie about length. */
export const MAX_WIDGET_RESPONSE_BYTES = 1024 * 1024;

/** The timeout signal remains attached to the response body as well as headers. */
export async function fetchWidgetJson(url: string, timeoutMs = 8_000): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("Widget provider returned " + response.status);
  }
  if (!response.body) throw new Error("Widget provider returned an empty response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_WIDGET_RESPONSE_BYTES) throw new Error("Widget provider response exceeds the size limit");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    // Never wait for a malfunctioning provider to acknowledge cancellation.
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
