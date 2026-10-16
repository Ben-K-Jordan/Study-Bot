import type { Metadata, Viewport } from "next";
import "@fontsource-variable/google-sans-flex/rond.css";
import "@fontsource-variable/google-sans-code/wght.css";
import "./globals.css";
import { Providers } from "@/components/providers";
import { THEME_COLORS } from "@/components/shell/theme-colors";
import { TITLE_TEMPLATE } from "@/lib/metadata";

export const metadata: Metadata = {
  title: {
    default: "Study Bot",
    template: TITLE_TEMPLATE,
  },
  description: "Plan for your exams and practice from your own course files.",
  applicationName: "Study Bot",
  manifest: "/manifest.json",
};

// First paint follows the system theme; ThemeColorSync (in Providers)
// follows a manual Light or Dark choice after hydration.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
