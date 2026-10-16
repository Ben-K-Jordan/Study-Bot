"use client"

import * as React from "react"
import { FileUpIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ACCEPTED_FILES } from "@/components/materials/file-rules"

function hasFiles(event: React.DragEvent | DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files")
}

/**
 * A labelled drop zone with a real "Choose files" button. Dropping files
 * anywhere on the zone, or picking them with the button (keyboard and touch),
 * calls onFiles. The file input is hidden and never nested in a button.
 * While mounted, files dropped elsewhere on the page are ignored instead of
 * making the browser open them and leave the page.
 */
export function FileDropzone({
  label,
  description,
  onFiles,
  disabled = false,
  disabledReason,
  className,
}: {
  /** Visible name of the zone: "Course materials". */
  label: string
  /** The rule, shown before anyone picks a file. */
  description: string
  onFiles: (files: File[]) => void
  disabled?: boolean
  /** Shown instead of the button hint while disabled: "Enter the course name first." */
  disabledReason?: string
  className?: string
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)
  const depth = React.useRef(0)
  const labelId = React.useId()
  const descriptionId = React.useId()
  const reasonId = React.useId()

  // Files dropped outside the zone would otherwise replace the page
  React.useEffect(() => {
    const block = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    }
    window.addEventListener("dragover", block)
    window.addEventListener("drop", block)
    return () => {
      window.removeEventListener("dragover", block)
      window.removeEventListener("drop", block)
    }
  }, [])

  function onDragEnter(event: React.DragEvent) {
    if (!hasFiles(event)) return
    event.preventDefault()
    depth.current += 1
    if (!disabled) setDragging(true)
  }

  function onDragOver(event: React.DragEvent) {
    if (!hasFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = disabled ? "none" : "copy"
  }

  function onDragLeave(event: React.DragEvent) {
    if (!hasFiles(event)) return
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setDragging(false)
  }

  function onDrop(event: React.DragEvent) {
    if (!hasFiles(event)) return
    event.preventDefault()
    depth.current = 0
    setDragging(false)
    if (disabled) return
    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) onFiles(files)
  }

  function onInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    // Reset so picking the same file again still fires a change
    event.target.value = ""
    if (files.length > 0) onFiles(files)
  }

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={disabled && disabledReason ? `${descriptionId} ${reasonId}` : descriptionId}
      data-dragging={dragging || undefined}
      data-disabled={disabled || undefined}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-outline px-4 py-5 text-center sm:py-6 transition-colors duration-150 ease-standard",
        "data-dragging:border-primary data-dragging:bg-primary/8",
        "data-disabled:border-outline-variant",
        className
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container"
      >
        <FileUpIcon className="size-6" />
      </span>
      <div className="flex flex-col gap-1">
        <p id={labelId} className="type-title-s text-on-surface">
          {dragging ? "Drop to upload" : label}
        </p>
        <p id={descriptionId} className="type-body-m text-on-surface-variant">
          {description}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        aria-describedby={descriptionId}
      >
        Choose files
      </Button>
      <p className="hidden type-body-s text-on-surface-variant pointer-fine:block" aria-hidden="true">
        Or drag files here.
      </p>
      {disabled && disabledReason ? (
        <p id={reasonId} className="type-body-s text-on-surface-variant">
          {disabledReason}
        </p>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        onChange={onInputChange}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        disabled={disabled}
      />
    </div>
  )
}
