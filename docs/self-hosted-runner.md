# Windows self-hosted CI runner

The repository CI is designed for one dedicated repository-level Windows runner.

## Required runner label

The workflow requires exactly one label:

- `start-tab-chromium-ci`

No operating-system, architecture, or generic `self-hosted` label is referenced by `.github/workflows/ci.yml`. The runner is selected only by the project-specific label.

GitHub normally assigns default labels such as `self-hosted`, `windows`, and `x64` automatically. They may remain visible, but CI does not depend on them. To register a new runner with literally only the project label, use the repository-provided Windows registration command and add:

```powershell
config.cmd --url https://github.com/lgg/start-tab-chromium --token <REGISTRATION_TOKEN> --no-default-labels --labels start-tab-chromium-ci
```

Do not assign `start-tab-chromium-ci` to runners used by other repositories, and do not assign it to more than one online runner if strict single-build execution is required.

## Why builds run sequentially

The workflow intentionally has one job and no `concurrency` group. A single online runner matching `start-tab-chromium-ci` can execute only one job at a time. Additional jobs requiring that label stay in GitHub's runner queue until the runner is idle, so older waiting runs are not replaced by newer runs.

If a second runner receives the same label, GitHub may execute two jobs in parallel. Keep the label exclusive to one runner.

## Windows host requirements

- Windows 10 or Windows 11 x64.
- A current GitHub Actions runner, version **2.329.0 or newer**.
- Git for Windows available to the runner service account.
- Network access to GitHub, the GitHub Actions cache service, the Node.js distribution endpoints, and the npm registry.
- Enough disk space for dependencies and three extension build directories. Keep at least 5 GB free for comfortable operation.
- The runner service account must have read/write/delete access to its own `_work` directory.

Node.js does not need to be installed globally: `actions/setup-node` installs the validated Node.js 22 x64 toolchain for each job.

## Docker Desktop

This repository does not contain a Dockerfile or Compose configuration, and its build/test commands do not use Docker. Docker Desktop may remain installed for other projects, but this workflow does not create, stop, prune, or remove any Docker containers, images, networks, volumes, builders, or caches.

Any host-level Docker cache policy must be managed separately and must account for all projects using Docker Desktop. Do not add global `docker system prune`, `docker image prune`, `docker volume prune`, or `docker builder prune` commands to this workflow.

## Cache behavior

The workflow caches only npm's download cache, never `node_modules` or build outputs. The cache key includes:

- repository-specific prefix;
- runner OS;
- runner architecture;
- Node.js major version 22;
- `package-lock.json` hash.

The local npm cache is redirected to `.ci-cache/npm` inside `GITHUB_WORKSPACE`. It is saved to the GitHub Actions cache after a successful dependency installation and deleted from the Windows workspace during final cleanup. In repository **Settings -> Actions -> General -> Cache settings**, keep cache retention at **1 day** and use a conservative repository cache-size limit.

## Build outputs and artifacts

CI builds all three profiles to validate them:

- `build/`
- `build-blocker-only/`
- `build-google/`

The workflow does not package or upload any build artifacts, test reports, logs, or source snapshots. All generated build directories are temporary and are deleted at the end of the job, including after failures.

## Workspace cleanup

The workflow uses `actions/checkout` with `clean: true`, removes known stale outputs before checkout, and repeats cleanup with `if: always()` after validation.

Only these project-local paths may be removed:

- `node_modules/`
- `.ci-cache/`
- `build/`
- `build-blocker-only/`
- `build-google/`
- `locale-parity-report.json`

Every path is resolved and verified to be a descendant of `GITHUB_WORKSPACE`. The workflow never deletes the runner installation directory, drive root, another repository workspace, or global package/Docker caches.

## Events and fork security

CI runs for:

- pull requests targeting `master` from branches in this repository;
- pushes to `master`;
- manual `workflow_dispatch` runs.

Pull requests from forks do not execute on the self-hosted runner. The workflow does not use `pull_request_target`, and its token permission is limited to `contents: read`.

This is a public repository, so treat write access to repository branches and approval of workflow changes as permission to execute code on the Windows runner. Never approve or manually dispatch a fork-authored workflow on this runner. Keep GitHub's outside-collaborator workflow approval enabled, review every workflow diff before approval, and reserve same-repository branches for trusted contributors.

## Secrets and variables

No repository secret or Actions variable is required for CI. The Google-enabled validation uses the non-production value `ci-validation.apps.googleusercontent.com` only to validate build structure. A real production OAuth client ID must be supplied outside normal CI when preparing and manually testing a production Google-enabled package.

## GitHub repository settings

Configure these once in GitHub; they cannot be expressed inside the workflow YAML:

- Keep Actions cache retention at **1 day**.
- Require approval for workflows from outside collaborators and never approve a fork workflow for the self-hosted runner.
- Keep `start-tab-chromium-ci` assigned to exactly one repository runner.

No artifact-retention setting is required for this workflow because it does not upload artifacts.

## Host-level maintenance

The repository workflow cleans only its own workspace. Separately monitor:

- free disk space;
- runner `_diag` logs;
- runner temporary directories;
- the runner application version;
- Windows updates and reboots;
- Docker Desktop storage if other repositories use Docker.

A runner cleanup hook is optional, not required by this workflow. Any hook must use the runtime-provided workspace path and must not contain hard-coded machine-specific absolute paths in the repository.
