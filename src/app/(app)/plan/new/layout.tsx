import type { Metadata } from "next"
import { TITLE_TEMPLATE } from "@/lib/metadata"

export const metadata: Metadata = {
  // The page titles itself while replacing a plan, so pass the template on
  title: { default: "New plan", template: TITLE_TEMPLATE },
}

export default function NewPlanLayout({ children }: { children: React.ReactNode }) {
  return children
}
