import { ImageResponse } from "next/og";
import { AppIconArt } from "./app-icon";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<AppIconArt size={32} rounded />, size);
}
