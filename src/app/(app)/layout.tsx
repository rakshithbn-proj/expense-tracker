import { requireUser } from "@/server/auth/dal";
import { logout } from "./actions";
import { SideNav, TabBar } from "./nav";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();

  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden w-60 shrink-0 flex-col gap-6 border-r border-border bg-surface p-4 md:flex">
        <div className="px-3 pt-2 text-lg font-semibold">Expenses</div>
        <SideNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between bg-brand px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-brand-contrast md:bg-transparent md:text-foreground">
          <span className="text-lg font-semibold md:hidden">Expenses</span>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden opacity-80 sm:inline" data-testid="signed-in-as">
              {user.email}
            </span>
            <form action={logout}>
              <button type="submit" className="rounded-lg border border-current/30 px-3 py-1.5 font-medium">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-4 md:px-8 md:pb-10">{children}</main>
      </div>

      <TabBar />
    </div>
  );
}
