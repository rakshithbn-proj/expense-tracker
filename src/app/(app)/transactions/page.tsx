import { requireUser } from "@/server/auth/dal";
import { NotBuilt } from "../not-built";

export const metadata = { title: "Transactions · Expenses" };

export default async function TransactionsPage() {
  // Layouts are not re-checked on client navigation, so every page authorizes itself.
  await requireUser();
  return <NotBuilt title="Transactions" milestone={3} summary="Search, filters, transaction details, source provenance and category corrections." />;
}
