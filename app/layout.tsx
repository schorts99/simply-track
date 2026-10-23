import type { Metadata, Viewport } from "next";
import "./globals.css";
import { I18nProvider } from "@/src/shared/i18n/provider";
import { ThemeProvider } from "@/src/shared/theme/provider";
import { themeBootstrap } from "@/src/shared/theme/theme";

export const metadata: Metadata = {
  title: "SimplyTrack | A little more clarity",
  description: "A private, local-first space to track your money, plan your spending, and save for what matters.",
  applicationName: "SimplyTrack",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "SimplyTrack" },
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f7f8fa" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /></head>
      <body><I18nProvider><ThemeProvider>{children}</ThemeProvider></I18nProvider></body>
    </html>
  );
}
