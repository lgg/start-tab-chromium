# Manual QA — Round 52 remote backup concurrency

1. Open Start Tab Options in two extension tabs. In tab A start **Browser Sync → Sync now** against a remote backup, then immediately change and save a visible setting or blocklist entry in tab B. The newer edit must remain; Sync may retry/reconcile, but it must not restore an older remote state over that edit.
2. In two tabs, start **Browser Sync → Upload** in tab A and immediately save a different local change in tab B. When Upload reports success, run Sync again or inspect the second profile: the successful remote snapshot must include the latest stable local change rather than the earlier captured version.
3. With a Browser Sync backup available, confirm **Restore** in tab A and save a local change in tab B while the restore is loading. The restore must fail with an error instead of silently erasing the newer local edit. Re-run Restore only if overwriting that edit is still intended.
4. Repeat the previous test with **Google Drive → Restore** while authenticated. A local change saved from another tab during the list/download window must survive and the restore must report failure rather than overwrite it.
5. After an uncontended Browser Sync Upload, Restore, and Sync Now, verify ordinary success messages still appear and a second Sync Now reports unchanged when content really matches.
6. Verify blocklist redirects and running timer alarms remain intact after a rejected concurrent Restore; a revision conflict must occur before backup import touches recovery storage, DNR rules, or alarms.
