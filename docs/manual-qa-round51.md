# Round 51 manual QA — native new tab

These checks require a real unpacked Chromium extension and are not replaced by the deterministic fixtures.

1. In the full profile, use **Open the browser's native new tab** repeatedly. Each action should open the browser-owned native new tab without flashing or leaving a temporary `about:blank` tab.
2. Trigger the action rapidly several times. Every requested native new tab should resolve independently; no earlier request should consume or overwrite a later request's bypass.
3. Repeat while the browser is under load so navigation settles slowly. An expired attempt must fall through to the supported fallback URLs instead of reporting a false success.
4. If the browser rejects every native-new-tab candidate, confirm the temporary tab is removed and the UI reports failure rather than leaving an orphan tab.
5. Open ordinary new tabs before and after the native-new-tab action. Normal Start Tab interception must continue working; a stale/expired bypass must not suppress an unrelated tab.
6. Repeat after restarting the browser. A stale storage entry from an older session must not bypass Start Tab, delete a newer grant, or prevent fallback recovery.
