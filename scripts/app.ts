// Starts and stops the whole local app in the background, independent of any terminal window.
//
//   npm run app:start    database → migrations → web app (http://localhost:3000) → worker
//   npm run app:stop     worker and web app, then a clean database shutdown
//   npm run app:status   what's running, and where the logs are
//
// Closing a terminal window doesn't stop anything; always use app:stop. Logs are in .data/logs.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { isPgRunning, LOCAL_PG, startPg, stopPg } from "./lib/local-pg";

loadEnvConfig(process.cwd());

const STATE = path.resolve(".data/run/app.json");
const LOGS = path.resolve(".data/logs");
const WEB_PORT = 3000;

type State = { web?: number; worker?: number; startedAt: string };

const readState = (): State | null => (existsSync(STATE) ? (JSON.parse(readFileSync(STATE, "utf8")) as State) : null);

function alive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

// Runs a Node entry point in the background with its output going to a log file.
function launch(name: string, args: string[]): number {
  const log = openSync(path.join(LOGS, `${name}.log`), "a");
  const child = spawn(process.execPath, args, { detached: true, stdio: ["ignore", log, log], windowsHide: true, env: process.env });
  child.unref();
  if (!child.pid) throw new Error(`Couldn't start ${name}`);
  return child.pid;
}

// Stops a process and everything it started. The web app and worker hold no state that needs
// a graceful exit: the worker's queue lives in the database, which is shut down cleanly after.
function kill(pid: number) {
  if (!alive(pid)) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      process.kill(pid, "SIGTERM");
    }
  }
}

async function waitForHealth(timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://localhost:${WEB_PORT}/api/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function start() {
  const state = readState();
  if (state && (alive(state.web) || alive(state.worker))) {
    console.log("The app is already running. Use `npm run app:status`, or `npm run app:stop` first.");
    return;
  }
  if (await portInUse(WEB_PORT)) {
    throw new Error(`Port ${WEB_PORT} is already in use (perhaps \`npm run dev\` in another window). Stop that first.`);
  }
  mkdirSync(LOGS, { recursive: true });
  mkdirSync(path.dirname(STATE), { recursive: true });

  process.stdout.write("Database… ");
  console.log((await startPg()) === "started" ? "started" : "already running");

  process.stdout.write("Migrations… ");
  const { runMigrations } = await import("../src/server/db/migrate");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (copy .env.example to .env.local)");
  await runMigrations(url);
  console.log("up to date");

  const next: State = { startedAt: new Date().toISOString() };
  next.web = launch("web", [path.resolve("node_modules/next/dist/bin/next"), "dev", "-p", String(WEB_PORT)]);
  next.worker = launch("worker", [path.resolve("node_modules/tsx/dist/cli.mjs"), "--conditions=react-server", path.resolve("scripts/worker.ts")]);
  writeFileSync(STATE, JSON.stringify(next, null, 2));

  process.stdout.write("Web app… ");
  if (!(await waitForHealth(120_000))) {
    console.log(`not responding yet; check ${path.join(LOGS, "web.log")}`);
  } else {
    console.log("ready");
  }
  console.log(`\nOpen http://localhost:${WEB_PORT}\nWorker running (Gmail checks every minute). Logs: ${LOGS}\nStop everything with: npm run app:stop`);
}

async function stop() {
  const state = readState();
  for (const [name, pid] of [["worker", state?.worker], ["web app", state?.web]] as const) {
    if (pid && alive(pid)) {
      kill(pid);
      console.log(`Stopped the ${name}.`);
    }
  }
  if (state) rmSync(STATE, { force: true });

  const result = await stopPg();
  console.log(result === "stopped" ? "Database shut down cleanly." : "Database wasn't running.");
}

async function status() {
  const state = readState();
  const db = await isPgRunning();
  const web = alive(state?.web);
  const worker = alive(state?.worker);
  let healthy = false;
  try {
    healthy = web && (await fetch(`http://localhost:${WEB_PORT}/api/health`)).ok;
  } catch {
    healthy = false;
  }
  console.log(`Database (port ${LOCAL_PG.port}): ${db ? "running" : "stopped"}`);
  console.log(`Web app: ${web ? (healthy ? `running at http://localhost:${WEB_PORT}` : "starting or unhealthy (see web.log)") : "stopped"}`);
  console.log(`Worker: ${worker ? "running" : "stopped"}`);
  if (state?.startedAt) console.log(`Started: ${new Date(state.startedAt).toLocaleString("en-IN")}`);
  console.log(`Logs: ${LOGS}`);
}

const command = process.argv[2];
const run = command === "start" ? start : command === "stop" ? stop : command === "status" ? status : null;
if (!run) {
  console.error("Usage: app.ts <start|stop|status>");
  process.exit(1);
}
run().then(
  () => process.exit(0),
  (err) => {
    console.error(`\n${err instanceof Error ? err.message : err}`);
    process.exit(1);
  },
);
