# ADR-0002: Local development on Windows

Status: **Accepted** (2026-10-22, user decision)

## Context

The Windows 11 Home development machine has no WSL2 and no Docker. Installing them needs admin
rights and a reboot. Production runs on Docker Compose on a VPS.

## Decision

- **No Docker on the development machine.**
- Local PostgreSQL comes from the `embedded-postgres` npm package. It downloads real PostgreSQL
  binaries into the project and runs them as a normal user process. `npm run db:start` starts it
  and data lives in `.data/postgres` (git-ignored).
- Tests create a throwaway database on the same embedded server, so they run against real Postgres.
- The app and worker run natively on Node 24.
- The `Dockerfile` and `compose.yaml` are still maintained in the repo. They are first built and
  checked in **GitHub Actions** (if the repo is hosted on GitHub), and otherwise on the VPS with
  `docker compose up --build`.
- All npm scripts are cross-platform (no bash-only syntax). Docs give PowerShell commands.

## Consequences

- No admin rights or reboot are needed.
- Dockerfile and Compose mistakes are caught in CI or on the VPS, not locally.
- The Milestone 8 backup-and-restore test runs on the VPS, or in CI against a throwaway database.
- The embedded Postgres major version is pinned to match the production image (18), so migrations behave the same.
