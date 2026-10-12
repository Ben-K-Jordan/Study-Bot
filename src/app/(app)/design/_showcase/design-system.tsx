"use client"

import { AppBarTitle } from "@/components/shell/app-bar-title"
import { PageContainer } from "@/components/app/page-container"
import { PageHeader } from "@/components/app/page-header"
import { ThemeToggle } from "@/components/app/theme-toggle"

import { AppComponents } from "./app-components"
import { Actions, Inputs } from "./controls"
import { Foundations } from "./foundations"
import { LessonPrimitives } from "./lesson"
import { HomeRecipe, Rules } from "./recipes"
import { DataDisplay, Feedback, Navigation, Overlays } from "./surfaces"

const SECTIONS = [
  { id: "foundations", label: "Foundations" },
  { id: "actions", label: "Actions" },
  { id: "inputs", label: "Inputs" },
  { id: "navigation", label: "Navigation" },
  { id: "data", label: "Data display" },
  { id: "feedback", label: "Feedback" },
  { id: "overlays", label: "Overlays" },
  { id: "app", label: "App components" },
  { id: "lesson", label: "Lesson" },
  { id: "rules", label: "Do and don't" },
  { id: "recipe", label: "Recipe" },
]

export function DesignSystem() {
  return (
    <PageContainer size="wide" className="gap-12">
      <AppBarTitle>Design system</AppBarTitle>
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Study Bot design system"
          description="Every token, the type scale, the shared components and the lesson primitives, in both themes. Development only."
          actions={<ThemeToggle variant="segmented" />}
        />
        <nav aria-label="Sections" className="-mx-1 overflow-x-auto no-scrollbar">
          <ul className="flex w-max gap-2 px-1 py-1">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="state-layer relative isolate inline-flex h-8 items-center rounded-lg border border-outline-variant px-3 type-label-l text-on-surface-variant"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <Foundations />
      <Actions />
      <Inputs />
      <Navigation />
      <DataDisplay />
      <Feedback />
      <Overlays />
      <AppComponents />
      <LessonPrimitives />
      <Rules />
      <HomeRecipe />
    </PageContainer>
  )
}
