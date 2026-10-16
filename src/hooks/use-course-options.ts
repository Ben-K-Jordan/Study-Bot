"use client";

import { useMemo } from "react";
import type { CourseOption } from "@/lib/client-api";
import { useApi } from "@/lib/swr";
import { courseKey } from "@/hooks/use-active-course";

/** The fields of /api/content/documents this hook reads. */
export interface CourseDocument {
  course_name: string | null;
  exam_name: string | null;
  /** UPLOADED, PENDING, PROCESSED or FAILED. */
  status?: string | null;
  created_at?: string | null;
}

interface DocumentsResponse {
  documents?: CourseDocument[];
}

export interface CourseChoice extends CourseOption {
  /** "Course||Exam", the value useActiveCourse stores. */
  key: string;
  /** Files that finished processing, so questions can come from them. */
  ready_count: number;
}

/**
 * Groups the student's files into course (and exam) choices, in the order
 * the switcher lists them and the default course is picked from: courses
 * with at least one ready file first, then the course with the most recent
 * upload. A course whose files are all still processing (or failed) can't
 * feed a session yet, so it never becomes the default over one that can.
 */
export function buildCourseOptions(documents: readonly CourseDocument[]): CourseChoice[] {
  const byKey = new Map<string, CourseChoice & { latest: string }>();
  for (const doc of documents) {
    if (!doc.course_name) continue;
    const key = courseKey(doc.course_name, doc.exam_name);
    const ready = doc.status === "PROCESSED" ? 1 : 0;
    const created = doc.created_at ?? "";
    const existing = byKey.get(key);
    if (existing) {
      existing.doc_count++;
      existing.ready_count += ready;
      if (created > existing.latest) existing.latest = created;
    } else {
      byKey.set(key, {
        key,
        course_name: doc.course_name,
        exam_name: doc.exam_name ?? undefined,
        doc_count: 1,
        ready_count: ready,
        latest: created,
      });
    }
  }
  return [...byKey.values()]
    .sort((a, b) => {
      const readyFirst = Number(b.ready_count > 0) - Number(a.ready_count > 0);
      if (readyFirst !== 0) return readyFirst;
      if (a.latest !== b.latest) return a.latest < b.latest ? 1 : -1;
      return a.course_name.localeCompare(b.course_name) || a.key.localeCompare(b.key);
    })
    .map(({ latest: _latest, ...choice }) => choice);
}

/**
 * The courses (and exams) the student has uploaded materials for, with file
 * counts, built from /api/content/documents and ordered as in
 * buildCourseOptions.
 */
export function useCourseOptions() {
  const { data, error, isLoading, mutate } = useApi<DocumentsResponse>(
    "/api/content/documents?namespace=COURSE"
  );

  const options = useMemo<CourseChoice[] | undefined>(
    () => (data ? buildCourseOptions(data.documents ?? []) : undefined),
    [data]
  );

  const keys = useMemo(() => options?.map((o) => o.key), [options]);

  return { options, keys, error, isLoading, retry: () => mutate() };
}
