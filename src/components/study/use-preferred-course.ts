"use client"

import { useLayoutEffect, useMemo } from "react"

import {
  courseKey,
  getStoredActiveCourse,
  parseCourseKey,
  storeActiveCourse,
} from "@/hooks/use-active-course"
import type { CoursePreference } from "@/components/study/course-preference"

/**
 * The first preference the student has materials for, as a course switcher
 * key. Materials can be filed under the exam or under the course alone, so a
 * plan for "CS 2110, Prelim 1" also matches "CS 2110" files.
 */
export function preferredCourseKey(
  keys: readonly string[],
  preferences: readonly CoursePreference[],
): string | null {
  for (const preference of preferences) {
    const exact = courseKey(preference.courseName, preference.examName)
    if (keys.includes(exact)) return exact
    const sameCourse = keys.find((key) => parseCourseKey(key).courseName === preference.courseName)
    if (sameCourse) return sameCourse
  }
  return null
}

/**
 * Opens the screen on the course with today's session (else the nearest
 * exam) when the student hasn't chosen a course that still exists, instead
 * of the course with the latest upload.
 *
 * Returns the keys with that course first, for useActiveCourse, so this
 * screen shows it from the first render. It also stores it as the active
 * course before paint, so the course switcher and the other screens show
 * the same course. A course the student picked always wins.
 */
export function usePreferredCourse(
  keys: readonly string[] | undefined,
  preferences: readonly CoursePreference[] | undefined,
): readonly string[] | undefined {
  const preferred = useMemo(
    () => (keys && preferences?.length ? preferredCourseKey(keys, preferences) : null),
    [keys, preferences],
  )

  const ordered = useMemo(
    () =>
      !keys || !preferred || keys[0] === preferred ? keys : [preferred, ...keys.filter((key) => key !== preferred)],
    [keys, preferred],
  )

  useLayoutEffect(() => {
    if (!keys || !preferred) return
    const stored = getStoredActiveCourse()
    if (stored && keys.includes(stored)) return
    storeActiveCourse(preferred)
  }, [keys, preferred])

  return ordered
}
