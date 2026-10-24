// Local PostgreSQL controlled with PostgreSQL's own pg_ctl, so it starts detached from any
// terminal and stops with a clean shutdown (checkpoint, lock file removed). The embedded-postgres
// library is only used to create the data directory the first time: its own stop() force-kills
// the server on Windows.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

export const LOCAL_PG = {
  dataDir: path.resolve(".data/postgres"),
  logFile: path.resolve(".data/logs/postgres.log"),
  port: 5433,
  user: "postgres",
  password: "postgres",
  database: "expense_tracker",
};

const PLATFORM_PACKAGE = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
const PG_CTL = path.resolve(`node_modules/@embedded-postgres/${PLATFORM_PACKAGE}/native/bin/pg_ctl${process.platform === "win32" ? ".exe" : ""}`);

// Output is never piped back: a started server would inherit the pipe and the caller would hang.
function pgCtl(args: string[]): Promise<number> {
  if (!existsSync(PG_CTL)) throw new Error(`pg_ctl not found at ${PG_CTL}. Run npm install.`);
  return new Promise((resolve, reject) => {
    const child = spawn(PG_CTL, args, { stdio: "ignore", detached: true, windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

export async function isPgRunning(): Promise<boolean> {
  if (!existsSync(LOCAL_PG.dataDir)) return false;
  return (await pgCtl(["status", "-D", LOCAL_PG.dataDir])) === 0;
}

export async function startPg(): Promise<"started" | "already-running"> {
  mkdirSync(path.dirname(LOCAL_PG.logFile), { recursive: true });
  if (!existsSync(LOCAL_PG.dataDir)) {
    // First run on this machine: create the cluster (initdb).
    await new EmbeddedPostgres({
      databaseDir: LOCAL_PG.dataDir,
      port: LOCAL_PG.port,
      user: LOCAL_PG.user,
      password: LOCAL_PG.password,
      persistent: true,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      onLog: () => {},
    }).initialise();
  }
  if (await isPgRunning()) return "already-running";

  const code = await pgCtl(["start", "-D", LOCAL_PG.dataDir, "-o", `-p ${LOCAL_PG.port}`, "-l", LOCAL_PG.logFile, "-w", "-t", "60"]);
  if (code !== 0) throw new Error(`PostgreSQL didn't start (pg_ctl exit ${code}). See ${LOCAL_PG.logFile}`);

  const client = new pg.Client({ host: "localhost", port: LOCAL_PG.port, user: LOCAL_PG.user, password: LOCAL_PG.password, database: "postgres" });
  await client.connect();
  try {
    const { rowCount } = await client.query("select 1 from pg_database where datname = $1", [LOCAL_PG.database]);
    if (!rowCount) await client.query(`create database ${LOCAL_PG.database}`);
  } finally {
    await client.end();
  }
  return "started";
}

// "fast" shutdown: ends open connections, writes a checkpoint and removes the lock file.
export async function stopPg(): Promise<"stopped" | "not-running"> {
  if (!(await isPgRunning())) return "not-running";
  const code = await pgCtl(["stop", "-D", LOCAL_PG.dataDir, "-m", "fast", "-w", "-t", "60"]);
  if (code !== 0) throw new Error(`PostgreSQL didn't stop cleanly (pg_ctl exit ${code}). See ${LOCAL_PG.logFile}`);
  return "stopped";
}

export const localDatabaseUrl = () =>
  `postgres://${LOCAL_PG.user}:${LOCAL_PG.password}@localhost:${LOCAL_PG.port}/${LOCAL_PG.database}`;
