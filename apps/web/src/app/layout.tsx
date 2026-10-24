import type { Metadata, Viewport } from "next";
import { Roboto_Flex } from "next/font/google";
import { cookies } from "next/headers";
import { MotionProvider } from "@/components/shell/motion-provider";
import "./globals.css";

const robotoFlex = Roboto_Flex({
  subsets: ["latin"],
  axes: ["wdth", "opsz", "GRAD"],
  variable: "--font-roboto-flex",
  display: "swap",
});

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
    { media: "(prefers-color-scheme: dark)", color: "#111318" },
    { media: "(prefers-color-scheme: light)", color: "#f9f9ff" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = (await cookies()).get("faultline_theme")?.value;
  const dataTheme = theme === "light" || theme === "system" ? theme : "dark";
  return (
    <html lang="en" data-theme={dataTheme} className={robotoFlex.variable}>
      <body className="min-h-dvh">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
