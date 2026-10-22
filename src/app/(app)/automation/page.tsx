import { requireUser } from "@/server/auth/dal";
import { NotBuilt } from "../not-built";

export const metadata = { title: "Automation · Expenses" };

export default async function AutomationPage() {
  // Layouts are not re-checked on client navigation, so every page authorizes itself.
  await requireUser();
  return <NotBuilt title="Automation" milestone={4} summary="Capture sources and their real status, parser errors, retries, reconciliation progress and capture coverage." />;
}
