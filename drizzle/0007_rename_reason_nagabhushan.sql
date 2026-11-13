-- The "Why?" list in the Explain payments Shortcut had "Nagabhus"; the person is Nagabhushan.
-- Rename every past answer (audited like a correction; updated_at makes Sheets resync).
INSERT INTO "audit_events" ("user_id", "entity_type", "entity_id", "action", "metadata")
SELECT "user_id", 'transaction', "id"::text, 'correct',
  jsonb_build_object('changed', 'reason', 'before', "reason", 'after', 'Nagabhushan', 'by', 'migration 0007')
FROM "transactions" WHERE lower(btrim("reason")) = 'nagabhus';
--> statement-breakpoint
UPDATE "transactions" SET "reason" = 'Nagabhushan', "updated_at" = now() WHERE lower(btrim("reason")) = 'nagabhus';
