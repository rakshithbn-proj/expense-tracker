import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const EMAIL = "e2e@example.com";
export const PASSWORD = "e2e-password-123456";

export async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

// JSON API calls that share the signed-in page's session cookie.
export function api(page: Page, baseURL: string) {
  const req: APIRequestContext = page.request;
  const headers = { Origin: baseURL };
  return {
    async post<T = unknown>(path: string, data: unknown): Promise<T> {
      const res = await req.post(path, { headers, data });
      expect(res.ok(), `${path}: ${await res.text()}`).toBe(true);
      return res.json();
    },
    async get<T = unknown>(path: string): Promise<T> {
      const res = await req.get(path);
      expect(res.ok()).toBe(true);
      return res.json();
    },
  };
}
