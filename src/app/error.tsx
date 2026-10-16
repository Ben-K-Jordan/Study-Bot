"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CloudOffIcon, RotateCcwIcon } from "lucide-react";

import { StatusScreen } from "@/components/app/status-screen";
import { Button } from "@/components/ui/button";

/** Errors outside the app shell: auth screens and study sessions. */
export default function RootError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  /** Refetches and re-renders the segment (reset would only re-render the failed payload). */
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-dvh flex-col bg-surface">
      <StatusScreen
        icon={CloudOffIcon}
        tone="error"
        title="This page didn't load."
        description="Your saved work is safe. Retry, or go back to Home."
        actions={
          <>
            <Button onClick={() => retry()}>
              <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
              Retry
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Go to Home</Link>
            </Button>
          </>
        }
        footnote={error.digest ? `Reference: ${error.digest}` : undefined}
      />
    </main>
  );
}
