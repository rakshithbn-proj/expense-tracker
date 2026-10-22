# Environment Report — Milestone 0

Inspected: 2026-10-22, on the development machine (by Claude Code).

## Repository

- The project folder was empty and not a Git repository.
- Only the Milestone 0 documents in `docs/` exist so far. No application code yet.

## Windows development machine

| Item | Found | Notes |
|---|---|---|
| OS | Windows 11 Home Single Language 10.0.26200 | Home edition: Docker Desktop must use the WSL2 backend (Hyper-V isn't available) |
| RAM | 15.4 GB | Enough for Docker Desktop + Postgres + Next.js dev |
| Free disk (D:) | ~22 GB | Enough, but tight if Docker images live on D:. Docker's default location is C: |
| Git | 2.51.1 | OK |
| Node.js | v24.19.0 | OK. Use `npm.cmd` from PowerShell (the `npm.ps1` shim may be blocked by execution policy) |
| npm | 11.17.0 | OK |
| pnpm | Not installed | Not required. We will use npm |
| Python | 3.13.9 | Not required by the app |
| WSL2 | **Not installed** | `wsl.exe --status` says WSL isn't installed |
| Docker | **Not installed** | Needed for local Postgres parity and the production Compose stack |
| PostgreSQL / psql | **Not installed** | Will run in Docker |

## Decision (2026-10-22)

Docker and WSL2 will **not** be installed on this machine. Local Postgres uses `embedded-postgres`,
and Docker images are built in CI or on the VPS. See ADR-0002. The instructions below are kept
in case that changes.

## Optional installation (needs the user, admin rights and a reboot)

Run these in an **elevated** PowerShell (Run as Administrator):

```powershell
wsl --install            # installs WSL2 + Ubuntu; reboot when prompted
```

After rebooting:

1. Install Docker Desktop for Windows from <https://www.docker.com/products/docker-desktop/>. It's free for personal use. Keep "Use WSL 2 based engine" enabled.
2. Verify in a normal PowerShell:

```powershell
wsl --status
docker version
docker compose version
docker run --rm hello-world
```

All four must succeed before Milestone 1 can verify migrations against a real Postgres.

**Fallback if you prefer not to install Docker locally:** the test suite can use the
`embedded-postgres` npm package, which downloads real PostgreSQL binaries per project. This is
recorded as an option in ADR-0002, but Docker is preferred because production runs on Docker Compose.

## iPhone (reported by the user, NOT yet verified)

| Item | Status |
|---|---|
| iOS version | User reported **26.6.1**. Unverified. Confirm in Settings → General → About → iOS Version |
| Device model | Unknown. Matters only for Apple Intelligence actions, which we don't depend on |
| Apps installed | PhonePe, Google Pay, other UPI apps (user-reported) |

The device tests are listed in [capture-feasibility.md](../capture-feasibility.md#5-tests-that-must-be-run-on-the-actual-iphone).
