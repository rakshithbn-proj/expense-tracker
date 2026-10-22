import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Expenses",
    short_name: "Expenses",
    description: "Private expense tracker",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f3f5f8",
    theme_color: "#0b4f6c",
    icons: [
      { src: "/pwa-icons/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icons/512", sizes: "512x512", type: "image/png" },
      { src: "/pwa-icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
