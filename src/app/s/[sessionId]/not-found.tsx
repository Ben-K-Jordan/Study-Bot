import Link from "next/link";
import { SearchXIcon } from "lucide-react";

import { StatusScreen } from "@/components/app/status-screen";
import { Button } from "@/components/ui/button";

export default function SessionNotFound() {
  return (
    <StatusScreen
      icon={SearchXIcon}
      title="Session not found"
      description="This link doesn't match a session. It may have been deleted."
      actions={
        <>
          <Button asChild>
            <Link href="/">Go to Home</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/plan">Go to Plan</Link>
          </Button>
        </>
      }
    />
  );
}
