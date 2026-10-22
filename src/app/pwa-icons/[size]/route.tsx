import { ImageResponse } from "next/og";
import { AppIconArt } from "../../app-icon";

const SIZES = new Set([192, 512]);

export async function GET(_req: Request, ctx: RouteContext<"/pwa-icons/[size]">) {
  const size = Number((await ctx.params).size);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });
  return new ImageResponse(<AppIconArt size={size} rounded={false} />, {
    width: size,
    height: size,
    headers: { "Cache-Control": "public, max-age=604800" },
  });
}
