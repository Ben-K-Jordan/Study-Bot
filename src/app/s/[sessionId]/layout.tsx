import type { Metadata } from "next";
import { TITLE_TEMPLATE } from "@/lib/metadata";
import { SkipLink } from "@/components/shell/skip-link";

export const metadata: Metadata = {
  // Pages below set their own titles, so pass the template on
  title: { default: "Session", template: TITLE_TEMPLATE },
};

/**
 * Study sessions take the whole screen: no rail, no app bar. The .lesson
 * scope rounds the type (ROND 100), steps the weight up and switches to the
 * lesson palette. Screens inside use LessonFrame for the close button and
 * progress bar.
 */
export default function LessonLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lesson flex min-h-dvh flex-col">
      <SkipLink />
      <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}
