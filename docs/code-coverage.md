# Code coverage

Run `npm ci`, then `npm run test:coverage` (Node 22.15+).
The coverage command uses pinned c8 10.1.3 via npm exec, without modifying
the extension dependencies or lockfile. It needs npm registry access on
first use. CI executes it on the dedicated Windows runner.

The existing runtime fixture suites are discovered from npm test and run
in separate processes against individually transpiled TypeScript modules
with inline source maps. Build and tooling fixtures keep their original runners.
Static regex checks and builds are not counted as runtime execution.

c8 includes all production .ts and .js files under src, including unimported files.
The report is checked for missing files and printed per file to the job log
and GitHub Actions job summary. Reports and raw coverage are held in a
unique temporary directory and deleted after the run, without uploading
artifacts. No production OAuth credentials are required.

V8 branch/function counts for never-loaded files are synthetic rather than
a complete static inventory of their functions/branches; treat these
percentages as a baseline, not a proof of behavioral completeness.
Real browser E2E, browser-specific APIs, CSS and HTML are not measured.
CI enforces measured regression floors of 95% for lines, statements and functions, and 85% for V8 branches. The improvement target for branches is 90% or more. The exact unexecuted branch ranges are printed in the job log. Type-only modules have no executable JavaScript; their synthetic c8 zero is not a missing behavior test.

The round 55 suite exercises rendered UI with pinned jsdom 26.1.0 and
Chrome API doubles: editors, widgets, page entrypoints and worker dispatch.
It runs in separate Node processes and participates in the same coverage
measurement. Run independently with `npm run test:ui`. The browser DOM
emulator is not a replacement for real Chromium E2E acceptance.

The DOM suites now include failure and recovery paths for Browser Sync, blocklist and DNR transactions, popup and blocked-page lifecycles, provider responses, Options, widget persistence and asynchronous races. A successful commit is tested separately from a successful refresh; failed operations must preserve committed data and user drafts.
