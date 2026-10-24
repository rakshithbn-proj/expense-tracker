// Local-only PostgreSQL (ADR-0002). Never used in production, which runs the postgres:18 image.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import EmbeddedPostgres from "embedded-postgres";

export type EmbeddedPgOptions = {
  dataDir: string;
  port: number;
  persistent: boolean;
  database: string;
  quiet?: boolean;
};

export type RunningPg = { connectionString: string; stop: () => Promise<void> };

const USER = "postgres";
const PASSWORD = "postgres";

// On Windows the embedded library force-kills PostgreSQL, and PostgreSQL 18 helper processes
// ("--forkchild") can outlive their killed parent, still holding its port. A helper whose parent
// is gone does nothing useful, so it's safe to end. Running servers (whose parent may also be
// gone, e.g. after pg_ctl exits) are never touched: only "--forkchild" helpers are.
export function removeOrphanedPostgresHelpers() {
  if (process.platform !== "win32") return;
  const script =
    "$all = Get-CimInstance Win32_Process; $ids = @{}; $all | ForEach-Object { $ids[[int]$_.ProcessId] = $true }; " +
    "$all | Where-Object { $_.Name -eq 'postgres.exe' -and $_.CommandLine -match '--forkchild' -and -not $ids[[int]$_.ParentProcessId] } | " +
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
  spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore", windowsHide: true });
}

export async function startEmbeddedPg(opts: EmbeddedPgOptions): Promise<RunningPg> {
  removeOrphanedPostgresHelpers();
  const pg = new EmbeddedPostgres({
    databaseDir: opts.dataDir,
    port: opts.port,
    user: USER,
    password: PASSWORD,
    persistent: opts.persistent,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: opts.quiet ? () => {} : (m) => console.log(m),
    onError: (e) => console.error(e),
  });

  const fresh = !existsSync(opts.dataDir);
  if (fresh) await pg.initialise();
  await pg.start();

  const client = pg.getPgClient();
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      opts.database,
    ]);
    if (!rowCount) await pg.createDatabase(opts.database);
  } finally {
    await client.end();
  }

  return {
    connectionString: `postgres://${USER}:${PASSWORD}@localhost:${opts.port}/${opts.database}`,
    stop: () => pg.stop(),
  };
}
