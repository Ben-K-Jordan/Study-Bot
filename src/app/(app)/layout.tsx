import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";

// Home has no segment of its own, so the group carries its title; every
// other destination sets its own in its layout.
export const metadata: Metadata = {
  title: "Home",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
