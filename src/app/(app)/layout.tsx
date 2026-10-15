import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { TITLE_TEMPLATE } from "@/lib/metadata";

// Home has no segment of its own, so the group carries its title; every
// other destination sets its own in its layout and keeps the template.
export const metadata: Metadata = {
  title: { default: "Home", template: TITLE_TEMPLATE },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
