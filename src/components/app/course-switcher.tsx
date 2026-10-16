"use client"

import * as React from "react"
import Link from "next/link"

import { cn } from "@/lib/utils"
import { useActiveCourse } from "@/hooks/use-active-course"
import { useCourseOptions } from "@/hooks/use-course-options"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Picks the active course (and exam) for every screen. Reads the course
 * list from the student's materials and stores the choice through
 * useActiveCourse, so all screens follow it. Read the choice anywhere with
 * `useActiveCourse(keys)`.
 */
export function CourseSwitcher({
  label = "Course",
  hideLabel = false,
  size = "default",
  className,
}: {
  label?: string
  hideLabel?: boolean
  size?: "sm" | "default"
  className?: string
}) {
  const id = React.useId()
  const { options, keys, error, isLoading, retry } = useCourseOptions()
  const { activeCourse, setActiveCourse } = useActiveCourse(keys)

  const labelEl = (
    <label htmlFor={id} className={cn("type-label-l text-on-surface", hideLabel && "sr-only")}>
      {label}
    </label>
  )

  if (isLoading || (!options && !error)) {
    return (
      <div className={cn("flex w-full flex-col gap-2 sm:w-72", className)}>
        {hideLabel ? null : <Skeleton className="h-4 w-16" />}
        <Skeleton className={cn("w-full rounded-md sm:w-72", size === "sm" ? "h-10" : "h-12")} />
        <span className="sr-only" role="status">
          Loading courses…
        </span>
      </div>
    )
  }

  // A failed background refresh keeps the list it already has; only a
  // first load that failed replaces the switcher.
  if (error && !options) {
    return (
      <div className={cn("flex flex-wrap items-center gap-2 type-body-m text-error", className)} role="alert">
        Courses didn&apos;t load.
        <Button variant="text" size="sm" onClick={retry}>
          Retry
        </Button>
      </div>
    )
  }

  if (!options || options.length === 0) {
    return (
      <div className={cn("flex flex-wrap items-center gap-2 type-body-m text-on-surface-variant", className)}>
        No courses yet.
        <Button asChild variant="text" size="sm">
          <Link href="/plan/materials">Upload materials</Link>
        </Button>
      </div>
    )
  }

  return (
    // Full width on phones, one fixed width from 600px, so the field doesn't
    // change size from page to page or course to course
    <div className={cn("flex w-full flex-col gap-2 sm:w-72", className)}>
      {labelEl}
      <Select value={activeCourse ?? undefined} onValueChange={setActiveCourse}>
        <SelectTrigger id={id} size={size} className="w-full sm:w-72">
          <SelectValue placeholder="Choose a course" />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.key} value={option.key}>
                {option.course_name}
                {option.exam_name ? (
                  <>
                    <span aria-hidden="true" className="px-1.5 text-on-surface-variant">
                      ·
                    </span>
                    <span className="sr-only">, </span>
                    {option.exam_name}
                  </>
                ) : null}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}
