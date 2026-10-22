import { ImageResponse } from "next/og";
import { AppIconArt } from "./app-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS applies its own rounded mask, so the Home Screen icon is drawn square.
export default function AppleIcon() {
  return new ImageResponse(<AppIconArt size={180} rounded={false} />, size);
}
