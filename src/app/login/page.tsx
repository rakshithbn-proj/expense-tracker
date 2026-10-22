import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/dal";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Expenses" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-surface p-7 shadow-sm">
        <h1 className="text-2xl font-semibold">Expenses</h1>
        <p className="mt-1 mb-6 text-sm text-muted">Sign in to your private tracker.</p>
        <LoginForm />
      </div>
    </main>
  );
}
