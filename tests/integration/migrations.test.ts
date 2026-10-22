import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { runMigrations } from "@/server/db/migrate";

// Applies every migration to a brand-new empty database, twice.
describe("migrations", () => {
  const name = `et_migrate_${randomBytes(4).toString("hex")}`;
  const serverUrl = inject("serverUrl");
  const dbUrl = serverUrl.replace(/\/postgres$/, `/${name}`);

  afterAll(async () => {
    const admin = new Client({ connectionString: serverUrl });
    await admin.connect();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  });

  it("build the schema from a clean database and are idempotent", async () => {
    const admin = new Client({ connectionString: serverUrl });
    await admin.connect();
    await admin.query(`create database ${name}`);
    await admin.end();

    await runMigrations(dbUrl);
    await runMigrations(dbUrl);

    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    const { rows } = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    await client.end();
    expect(rows.map((r) => r.tablename)).toEqual([
      "audit_events",
      "budgets",
      "categories",
      "category_rules",
      "financial_accounts",
      "login_attempts",
      "sessions",
      "transactions",
      "users",
    ]);
  });
});
