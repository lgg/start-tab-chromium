# Round 41 manual QA — navigation and asynchronous race handling

- [ ] From Options or Start Tab, open the browser native new tab. Confirm it remains native after loading, title/favicon updates, and other status-only tab updates instead of redirecting back to Start Tab.
- [ ] Open a normal browser new-tab URL without the native bypass and confirm the fallback still redirects it to Start Tab where the browser exposes an explicit URL transition.
- [ ] Rapidly switch the locale between Auto, English, and Russian while the new-tab gate is loading; confirm the final selected locale owns every gate label and no older locale appears afterward.
- [ ] Change Start Tab enabled state while the gate is initializing; confirm the newest setting wins and no stale overlay replaces it later.
- [ ] Trigger and then exit a vendor Split View/tab-picker context while another gate refresh is pending; confirm only the newest context controls the overlay and page inert state.
- [ ] Open the popup on one site, switch the active tab to another host before clicking Block/Unblock, and confirm no action is applied to the originally displayed site; the popup should show the current active tab changed message.
- [ ] Open the popup, change the current host's block state from another extension surface, then click the old popup action; confirm the stale block state is rejected and refreshed.
- [ ] Rapidly activate popup block, clear, or language controls; confirm only one action runs, controls remain disabled while pending, and recover after success or failure.
