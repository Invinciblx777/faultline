"use server";

import { cookies } from "next/headers";

const THEMES = ["dark", "light", "system"] as const;
export type ThemePreference = (typeof THEMES)[number];

export async function setThemeAction(theme: string): Promise<void> {
  if (!(THEMES as readonly string[]).includes(theme)) return;
  (await cookies()).set("faultline_theme", theme, { path: "/", sameSite: "lax", maxAge: 365 * 24 * 3600, httpOnly: false });
}
