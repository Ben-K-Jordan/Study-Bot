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
      <body>
        <NavBar />
        <main style={{ paddingTop: NAV_HEIGHT }}>
          {children}
        </main>
      </body>
    </html>
  );
}
