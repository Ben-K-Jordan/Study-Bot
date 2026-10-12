import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DesignSystem } from "./_showcase/design-system";

export const metadata: Metadata = {
  title: "Design system",
  robots: { index: false },
};

/** Development-only reference page for the tokens and components. */
export default function DesignPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DesignSystem />;
}
