// Local-only PostgreSQL (ADR-0002). Never used in production, which runs the postgres:18 image.
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

export async function startEmbeddedPg(opts: EmbeddedPgOptions): Promise<RunningPg> {
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
