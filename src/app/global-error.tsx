"use client";

import "@fontsource-variable/google-sans-flex/rond.css";
import "./globals.css";
import { useEffect, useSyncExternalStore } from "react";
import { CloudOffIcon, RotateCcwIcon } from "lucide-react";

import { StatusScreen } from "@/components/app/status-screen";
import { Button } from "@/components/ui/button";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Last resort when the root layout itself fails. It replaces the whole
 * document, so it has no providers and follows the system theme directly.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const dark = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false
  );

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" className={dark ? "dark" : undefined}>
      <head>
        <title>Study Bot</title>
      </head>
      <body>
        <main id="main-content" tabIndex={-1} className="flex min-h-dvh flex-col bg-surface">
          <StatusScreen
            icon={CloudOffIcon}
            tone="error"
            title="Study Bot didn't load."
            description="Your saved work is safe. Retry, and if it keeps happening, reload the page."
            actions={
              <>
                <Button onClick={reset}>
                  <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
                  Retry
                </Button>
                {/* A full page load, since the client router may be what failed. */}
                <Button asChild variant="outline">
                  {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                  <a href="/">Go to Home</a>
                </Button>
              </>
            }
            footnote={error.digest ? `Reference: ${error.digest}` : undefined}
          />
        </main>
      </body>
    </html>
  );
}
