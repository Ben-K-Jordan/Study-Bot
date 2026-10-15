import Link from "next/link"
import { LayersIcon } from "lucide-react"

import { StatusScreen } from "@/components/app/status-screen"
import { Button } from "@/components/ui/button"

export default function ReviewNotFound() {
  return (
    <StatusScreen
      icon={LayersIcon}
      title="Deck not found"
      description="This link doesn't match one of your decks. It may have been deleted."
      actions={
        <Button asChild>
          <Link href="/flashcards">Go to flashcards</Link>
        </Button>
      }
    />
  )
}
