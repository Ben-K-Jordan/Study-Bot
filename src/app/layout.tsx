import type { Metadata, Viewport } from "next";
import "@fontsource-variable/google-sans-flex/rond.css";
import "@fontsource-variable/google-sans-code/wght.css";
import "./globals.css";
import { NavBar, NAV_HEIGHT } from "@/ui/components/NavBar";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: {
    default: "Study Bot",
    template: "%s · Study Bot",
  },
  description: "Plan for your exams and practice from your own course files.",
  applicationName: "Study Bot",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafd" },
    { media: "(prefers-color-scheme: dark)", color: "#131314" },
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
        <Providers>
          <NavBar />
          <main id="main-content" tabIndex={-1} style={{ paddingTop: NAV_HEIGHT }}>
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
