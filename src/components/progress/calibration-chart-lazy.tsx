"use client"

import dynamic from "next/dynamic"

import { Skeleton } from "@/components/ui/skeleton"

/** The chart library loads only on Progress, after the page's content. */
export const CalibrationChartLazy = dynamic(() => import("@/components/progress/calibration-chart"), {
  ssr: false,
  loading: () => <Skeleton aria-hidden="true" className="h-64 w-full rounded-xl" />,
})
