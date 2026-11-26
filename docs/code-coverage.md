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
No arbitrary minimum is imposed until the first baseline is verified.
