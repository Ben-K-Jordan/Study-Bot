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

            --color-bg-darkest: #1f2e1f;
            --color-bg: #2a3d2a;
            --color-bg-card: #334d33;
            --color-bg-input: #2d422d;
            --color-bg-done: #2d4a2d;

            --color-border: #4a6a4a;
            --color-border-subtle: #3a5a3a;
            --color-border-done: #5a8a5a;

            --color-text: #e8dcc8;
            --color-text-secondary: #c8bca8;
            --color-text-muted: #a89a82;
            --color-text-faint: #9a8a7a;
            --color-text-dim: #7a7060;

            --color-primary: #f0dc4e;
            --color-info: #7ec8e3;
            --color-success: #88cc88;
            --color-warning: #e8a040;
            --color-error: #e88888;
            --color-review: #c4a0ff;
          }
          body {
            margin: 0;
            background: var(--color-bg);
            line-height: 1.5;
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
