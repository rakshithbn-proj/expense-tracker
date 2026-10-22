import { requireUser } from "@/server/auth/dal";
import { NotBuilt } from "./not-built";

export const metadata = { title: "Overview · Expenses" };

export default async function OverviewPage() {
  // Layouts are not re-checked on client navigation, so every page authorizes itself.
  await requireUser();
  return <NotBuilt title="Overview" milestone={3} summary="Monthly net spending, budgets, categories, recent transactions and source health. Every figure will come from the database; nothing is shown until real data exists." />;
}
