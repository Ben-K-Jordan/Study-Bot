import Link from "next/link"
import { CircleAlertIcon, CircleCheckIcon, FileTextIcon, FolderOpenIcon, HourglassIcon, UploadIcon } from "lucide-react"

import { plural } from "@/lib/format"
import { SectionHeader } from "@/components/app/section-header"
import { Button } from "@/components/ui/button"
import type { MaterialDoc } from "@/components/materials/types"

const SHOWN = 5

function StatusText({ status }: { status: string }) {
  if (status === "PROCESSED") {
    return (
      <span className="flex shrink-0 items-center gap-1 type-body-s text-on-surface-variant">
        <CircleCheckIcon className="size-4 text-tertiary" aria-hidden="true" />
        Ready
      </span>
    )
  }
  if (status === "FAILED") {
    return (
      <span className="flex shrink-0 items-center gap-1 type-body-s text-error">
        <CircleAlertIcon className="size-4" aria-hidden="true" />
        Couldn&apos;t read
      </span>
    )
  }
  return (
    <span className="flex shrink-0 items-center gap-1 type-body-s text-on-surface-variant">
      <HourglassIcon className="size-4" aria-hidden="true" />
      Uploaded
    </span>
  )
}

/** The plan's course files in brief, with a link to manage them. */
export function PlanMaterials({ courseName, materials }: { courseName: string; materials: MaterialDoc[] }) {
  const href = `/plan/materials?course=${encodeURIComponent(courseName)}`
  const shown = materials.slice(0, SHOWN)
  const more = materials.length - shown.length

  return (
    <section aria-labelledby="plan-materials" className="flex flex-col gap-2">
      <SectionHeader
        id="plan-materials"
        as="h3"
        title="Materials"
        description={
          materials.length > 0
            ? plural(materials.length, { one: `# ${courseName} file`, other: `# ${courseName} files` })
            : undefined
        }
        action={materials.length > 0 ? { href, label: "Manage materials" } : undefined}
      />
      {materials.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-outline-variant px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <FolderOpenIcon className="mt-0.5 size-5 shrink-0 text-on-surface-variant" aria-hidden="true" />
            <div className="flex flex-col gap-0.5">
              <p className="type-title-s text-on-surface">No {courseName} materials yet</p>
              <p className="type-body-m text-on-surface-variant">
                Upload lecture slides or notes so sessions, flashcards, guides, and chat can use them.
              </p>
            </div>
          </div>
          <Button asChild variant="outline" className="shrink-0">
            <Link href={href}>
              <UploadIcon data-icon="inline-start" aria-hidden="true" />
              Upload materials
            </Link>
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-outline-variant rounded-2xl ring-1 ring-outline-variant">
          {shown.map((doc) => {
            const name = doc.original_filename || doc.title
            return (
              <li key={doc.document_id} className="flex items-center gap-3 px-4 py-2.5">
                <FileTextIcon className="size-5 shrink-0 text-on-surface-variant" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate type-body-m text-on-surface" title={name}>
                  {name}
                </span>
                <StatusText status={doc.status} />
              </li>
            )
          })}
          {more > 0 ? (
            <li className="px-4 py-2.5 type-body-m text-on-surface-variant">
              {plural(more, { one: "and # more file", other: "and # more files" })}
            </li>
          ) : null}
        </ul>
      )}
    </section>
  )
}
