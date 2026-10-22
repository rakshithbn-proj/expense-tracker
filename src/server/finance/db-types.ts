import type { Database } from "@/server/db/client";

// Either the pool-level database or an open transaction.
export type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];
