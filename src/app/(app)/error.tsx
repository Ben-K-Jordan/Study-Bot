"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CloudOffIcon, RotateCcwIcon } from "lucide-react";

import { StatusScreen } from "@/components/app/status-screen";
import { Button } from "@/components/ui/button";

/** A page inside the app shell failed to render; the shell stays usable. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatusScreen
      icon={CloudOffIcon}
      tone="error"
      headingLevel="h2"
      title="This page didn't load."
      description="Your saved work is safe. Retry, or go back to Home."
      actions={
        <>
          <Button onClick={reset}>
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
