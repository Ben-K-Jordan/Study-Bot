import type { Metadata } from "next";
import { NavBar, NAV_HEIGHT } from "@/ui/components/NavBar";

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
        <link
          href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&family=Patrick+Hand&display=swap"
          rel="stylesheet"
        />
        <style>{`
          :root {
            --font-display: 'Caveat', cursive;
            --font-body: 'Patrick Hand', cursive;
          }
          body {
            margin: 0;
            background: #2a3d2a;
          }
        `}</style>
      </head>
      <body>
        <NavBar />
        <main style={{ paddingTop: NAV_HEIGHT }}>
          {children}
        </main>
      </body>
    </html>
  );
}
