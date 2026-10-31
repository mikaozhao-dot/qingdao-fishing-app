# Bounded verification run manifest

- Run ID: `20261031T044810Z`
- Result: **STOPPED at the approved read-only `pg` dependency preflight; no application verification ran**
- Fixed implementation SHA: `e48de0bc22a28d41203d653fb1bedf8a2ecf071a`
- Execution start (UTC): `2026-10-31T04:51:24Z`
- Stop before follow-up verification (UTC): `2026-10-31T04:59:22Z`
- Host: macOS `26.6.2`; Node `v25.9.0`; PostgreSQL client/server `17.11 (Homebrew)`
- Temporary root: `/tmp/qf-e48de0bc.8ud3bq`
- Worktree: `/tmp/qf-e48de0bc.8ud3bq/worktree`; HEAD exactly equals the fixed SHA and `git status --porcelain` was empty.
- Final capture helper: source `capture-command.zsh`; SHA-256 `8dc7f086926c29b1ba363b9246ab0aa3c1591565ac9bfaea67071535fbb0e075`. Its final syntax/hash commands and all captured preflight streams/results are under `commands/`.
- Dependency preflight: fixed worktree `server/package.json` and `server/package-lock.json` both specify `pg` `8.23.1`. The approved existing source `/opt/homebrew/lib/node_modules/pg/package.json` could not be loaded; captured command `pg-version-triple` returned `PG_SOURCE_READ_FAILED:MODULE_NOT_FOUND`, exit code `2`. The installed-version comparison therefore did not pass.
- Stop condition: the revised plan requires immediate stop if the fixed existing module source is absent/unreadable. No fallback path was searched or used; no package was installed/copied/linked into the worktree; no package manager or network was used.
- Commands not run: PostgreSQL `initdb`, `pg_ctl`, `createdb`; either migration; application unit test; either application syntax check; PG integration harness. No PostgreSQL server/database or synthetic business rows were created.
- Code state: no application source, test, migration, dependency, or lockfile changed. The capture helper and run evidence are documentation artifacts only.
- Privacy audit: captured `privacy-scan` returned `LOG_PRIVACY=PASS files=96` (exit `0`) at `2026-10-31T05:02:33Z`; it scans archived command records for personal home paths and credential/connection-string markers without printing matched values.
- Time cap: 10 minutes from `2026-10-31T04:51:24Z` elapsed at `2026-10-31T05:01:24Z`. The run had already stopped at dependency preflight. After the cap, only evidence preservation/privacy audit was performed; no application, PostgreSQL, migration, or test command ran.
- Cleanup: not performed after the cap. Run-scoped resources remain at `/tmp/qf-e48de0bc.8ud3bq`: detached worktree `/tmp/qf-e48de0bc.8ud3bq/worktree`, empty PostgreSQL data/socket directories `/tmp/qf-e48de0bc.8ud3bq/pg/data` and `/tmp/qf-e48de0bc.8ud3bq/pg/socket`, and captured logs `/tmp/qf-e48de0bc.8ud3bq/capture/`. No PostgreSQL process was started. See `cleanup-stop.md`.
- Acceptance/review: this is a stopped-run report, not technical or product acceptance. It must be reviewed by Muse, then Dot for PL-E1/PL-E2; the matching notification slice remains frozen.
