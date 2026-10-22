import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistration } from "./sw-registration";
import "./globals.css";

export const metadata: Metadata = {
  title: "Expenses",
  description: "Private expense tracker",
  applicationName: "Expenses",
  appleWebApp: { capable: true, title: "Expenses", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0b4f6c" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1118" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className="h-full antialiased">
      <body className="min-h-full">
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
