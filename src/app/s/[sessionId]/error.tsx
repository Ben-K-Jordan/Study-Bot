"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CloudOffIcon, RotateCcwIcon } from "lucide-react";

import { StatusScreen } from "@/components/app/status-screen";
import { Button } from "@/components/ui/button";

/** The session page failed to render. Answers already submitted are saved on the server. */
export default function SessionError({
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
    <StatusScreen
      icon={CloudOffIcon}
      tone="error"
      title="This session didn't load."
      description="Your submitted answers are saved. Retry, or go back to Home."
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
  );
}
