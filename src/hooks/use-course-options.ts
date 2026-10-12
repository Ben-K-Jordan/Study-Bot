"use client";

import { useMemo } from "react";
import type { CourseOption } from "@/lib/client-api";
import { useApi } from "@/lib/swr";
import { courseKey } from "@/hooks/use-active-course";

interface DocumentsResponse {
  documents?: { course_name: string | null; exam_name: string | null }[];
}

export interface CourseChoice extends CourseOption {
  /** "Course||Exam", the value useActiveCourse stores. */
  key: string;
}

/**
 * The courses (and exams) the student has uploaded materials for, with a
 * file count each, built from /api/content/documents.
 */
export function useCourseOptions() {
  const { data, error, isLoading, mutate } = useApi<DocumentsResponse>(
    "/api/content/documents?namespace=COURSE"
  );

  const options = useMemo<CourseChoice[] | undefined>(() => {
    if (!data) return undefined;
    const byKey = new Map<string, CourseChoice>();
    for (const doc of data.documents ?? []) {
      if (!doc.course_name) continue;
      const key = courseKey(doc.course_name, doc.exam_name);
      const existing = byKey.get(key);
      if (existing) {
        existing.doc_count++;
      } else {
        byKey.set(key, {
          key,
          course_name: doc.course_name,
          exam_name: doc.exam_name ?? undefined,
          doc_count: 1,
        });
      }
    }
    return [...byKey.values()];
  }, [data]);

  const keys = useMemo(() => options?.map((o) => o.key), [options]);

  return { options, keys, error, isLoading, retry: () => mutate() };
}
