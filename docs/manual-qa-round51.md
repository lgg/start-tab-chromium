# Round 51 manual QA — native new tab

These checks require a real unpacked Chromium extension and are not replaced by the deterministic fixtures.

1. In the full profile, use **Open the browser's native new tab** repeatedly. Each action should open the browser-owned native new tab without flashing or leaving a temporary `about:blank` tab.
2. Trigger the action rapidly several times. Every requested native new tab should resolve independently; no earlier request should consume or overwrite a later request's bypass, and an older failure must not replace the visible status of a newer action.
3. Repeat while the browser is under load so navigation settles slowly. An expired attempt must fall through to the supported fallback URLs instead of reporting a false success.
4. If the browser rejects every native-new-tab candidate, confirm the temporary tab is removed and the UI displays the localized failure message next to the triggering button. Screen-reader inspection should expose that status as an alert.
5. After a visible failure, retry successfully. The stale error status should clear at the start of the new action and remain cleared after success.
6. With browser UI language set to Russian and Start Tab language set to **Auto**, verify the disabled/Split View gate, untitled-tab fallback, and native-new-tab failure status use Russian rather than English fallback text. Repeat once with explicit Russian and explicit English.
7. Open ordinary new tabs before and after the native-new-tab action. Normal Start Tab interception must continue working; a stale/expired bypass must not suppress an unrelated tab.
8. Repeat after restarting the browser. A stale storage entry from an older session must not bypass Start Tab, delete a newer grant, or prevent fallback recovery.
