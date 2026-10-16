"use client";

import useSWR, { type SWRConfiguration, type SWRResponse } from "swr";
import { ApiError, apiGet } from "@/lib/client-api";

/** Typed SWR fetcher on top of apiGet. Rejects with ApiError on a non-2xx. */
export function fetcher<T>(url: string): Promise<T> {
  return apiGet(url) as Promise<T>;
}

/** Defaults for the whole app; set once in <Providers>. */
export const swrConfig: SWRConfiguration = {
  fetcher,
  revalidateOnFocus: false,
  // Retry server and network failures, never client errors such as 401 or 404.
  shouldRetryOnError: (error: unknown) =>
    !(error instanceof ApiError) || error.status >= 500,
  errorRetryCount: 2,
};

/**
 * Read an API route with SWR. Pass null to skip (for example until a course
 * is chosen). The key is the URL, so changing the course changes the key and
 * a stale response can never land on the new course.
 *
 *   const { data, error, isLoading, mutate } = useApi<DecksResponse>(
 *     course ? `/api/flashcards?course=${encodeURIComponent(course)}` : null
 *   );
 */
export function useApi<T>(
  url: string | null,
  config?: SWRConfiguration<T, ApiError>
): SWRResponse<T, ApiError> {
  return useSWR<T, ApiError>(url, fetcher<T>, config);
}
