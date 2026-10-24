import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { MotionProvider } from "@/components/shell/motion-provider";
import { THEME_COLOR } from "@/design/theme-color";
import "@fontsource-variable/manrope";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Faultline", template: "%s · Faultline" },
  description: "Evidence-first web reliability engineering. Break it. Understand it. Fix it. Prove it.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = (await cookies()).get("faultline_theme")?.value;
  const dataTheme = theme === "light" || theme === "system" ? theme : "dark";
  return (
    <html lang="en" data-theme={dataTheme}>
      <body className="min-h-dvh">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
