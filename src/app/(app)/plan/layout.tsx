import type { Metadata } from "next";
import { TITLE_TEMPLATE } from "@/lib/metadata";

export const metadata: Metadata = {
  // Pages below set their own titles, so pass the template on
  title: { default: "Plan", template: TITLE_TEMPLATE },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
