import type { Metadata } from "next";
import Link from "next/link";
import { CompassIcon } from "lucide-react";

import { StatusScreen } from "@/components/app/status-screen";
import { AppMark } from "@/components/shell/app-mark";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="flex h-(--app-bar-height) items-center gap-3 px-4 sm:px-6">
        <AppMark className="size-8" />
        <span className="type-title-l text-on-surface">Study Bot</span>
      </header>
      <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col">
        <StatusScreen
          icon={CompassIcon}
          title="Page not found"
          description="This link doesn't match a page in Study Bot. Check the address, or start from Home."
          actions={
            <Button asChild>
              <Link href="/">Go to Home</Link>
            </Button>
          }
        />
      </main>
    </div>
  );
}
