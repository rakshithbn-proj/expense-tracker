import { sql } from "drizzle-orm";
import {
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  bigserial,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
});

// Only a SHA-256 hash of the session token is stored; the raw token lives in the cookie.
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ip: inet("ip"),
    succeeded: boolean("succeeded").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempts_attempted_at_idx").on(t.attemptedAt)],
);

// Never store secrets, tokens or raw email content in metadata.
export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    action: text("action").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_events_entity_idx").on(t.entityType, t.entityId)],
);
