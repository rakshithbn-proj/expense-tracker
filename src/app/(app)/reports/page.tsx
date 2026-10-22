import { requireUser } from "@/server/auth/dal";
import { NotBuilt } from "../not-built";

export const metadata = { title: "Reports · Expenses" };

export default async function ReportsPage() {
  // Layouts are not re-checked on client navigation, so every page authorizes itself.
  await requireUser();
  return <NotBuilt title="Reports" milestone={3} summary="Category, merchant, account, UPI-versus-card, cash-flow, budget and coverage reports." />;
}
