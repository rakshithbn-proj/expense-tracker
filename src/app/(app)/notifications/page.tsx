import { requireUser } from "@/server/auth/dal";
import { NotBuilt } from "../not-built";

export const metadata = { title: "Alerts · Expenses" };

export default async function NotificationsPage() {
  // Layouts are not re-checked on client navigation, so every page authorizes itself.
  await requireUser();
  return <NotBuilt title="Alerts" milestone={7} summary="Capture failures, authorization problems, uncategorized transactions, budget warnings and daily summaries." />;
}
