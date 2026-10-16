import Link from "next/link"
import { CalendarClockIcon, FileUpIcon, ListChecksIcon, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"

// The steps follow the New plan form the button opens: course, exam and
// study hours first, then the materials on the same form.
const STEPS: readonly { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: CalendarClockIcon,
    title: "Create a plan",
    body: "Name the course and exam, then set the exam date and the hours you can study.",
  },
  {
    icon: FileUpIcon,
    title: "Upload your materials",
    body: "On the same form, add lecture slides and notes as PDF, text, or Markdown.",
  },
  {
    icon: ListChecksIcon,
    title: "Answer from memory",
    body: "Each session takes about 30 minutes and asks questions from your files. Questions you get wrong come back until you answer them correctly on 2 different days.",
  },
]

/** Home for a student with no plan and no materials: one path forward. */
export function FirstRun() {
  return (
    <section aria-labelledby="first-run-title">
      <Card className="mx-auto w-full max-w-3xl">
        <CardHeader className="gap-2">
          <h2 id="first-run-title" className="type-headline-s text-balance text-on-surface">
            Plan for your first exam
          </h2>
          <p className="max-w-prose type-body-l text-pretty text-on-surface-variant">
            Upload your course files and set your exam date. Study Bot schedules practice questions from them up
            to the exam.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <h3 className="type-title-s text-on-surface">How it works</h3>
          <ol className="flex flex-col gap-4">
            {STEPS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex items-start gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5 pt-0.5">
                  <span className="type-title-m text-on-surface">{title}</span>
                  <span className="type-body-m text-pretty text-on-surface-variant">{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
        <CardFooter>
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href="/plan/new">New plan</Link>
          </Button>
        </CardFooter>
      </Card>
    </section>
  )
}
