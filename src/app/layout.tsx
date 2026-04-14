import type { Metadata } from "next";
import { NavBar, NAV_HEIGHT } from "@/ui/components/NavBar";
import { SessionProviderWrapper } from "@/ui/components/SessionProviderWrapper";
import { ServiceWorkerRegistration } from "@/ui/components/ServiceWorkerRegistration";
import "./globals.css";

export const metadata: Metadata = {
  title: "Study Bot",
  description: "Research-based study planner",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="manifest" href="/manifest.json" />
        <link
          href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&family=Patrick+Hand&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <SessionProviderWrapper>
          <a href="#main-content" className="skip-to-content">
            Skip to content
          </a>
          <ServiceWorkerRegistration />
          <NavBar />
          <main id="main-content" style={{ paddingTop: NAV_HEIGHT }}>
            {children}
          </main>
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
