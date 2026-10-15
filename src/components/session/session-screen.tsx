"use client";

import * as React from "react";
import Link from "next/link";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Leave the session: the X in the top-left corner, in the same place and
 * shape as the one LessonFrame draws on question screens.
 */
export function SessionCloseButton({
  href = "/",
  label = "Leave session",
  hint,
}: {
  href?: string;
  label?: string;
  /** Extra tooltip line, such as "Your answers are saved." */
  hint?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          aria-label={label}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-lesson-muted transition-colors hover:bg-lesson-option-hover hover:text-lesson-on-surface"
        >
          <XIcon className="size-6" strokeWidth={2.5} aria-hidden="true" />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom">{hint ? `${label}. ${hint}` : label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Full-screen frame for the screens around the questions (the intro and the
 * results), in the lesson grammar: an optional top bar with the close
 * button, a centred reading column, and a sticky footer holding the big
 * action, like LessonFrame's Check bar.
 */
export function SessionScreen({
  topBar,
  footer,
  stickyFooter = "always",
  children,
  className,
}: {
  /** Left side of the top bar; usually SessionCloseButton. Omit for no bar. */
  topBar?: React.ReactNode;
  footer?: React.ReactNode;
  /**
   * "always" keeps the action bar on screen; "wide" only from 600px, for
   * long screens whose stacked phone buttons would take a quarter of the view.
   */
  stickyFooter?: "always" | "wide";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="session-screen" className={cn("flex min-h-dvh flex-1 flex-col", className)}>
      {topBar ? (
        <div className="sticky top-0 z-10 bg-lesson-surface">
          <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-4 py-4 sm:gap-4 sm:px-8 sm:py-6">
            {topBar}
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          "mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 pb-10 sm:px-8",
          topBar ? "pt-2 sm:pt-4" : "pt-10 sm:pt-16"
        )}
      >
        {children}
      </div>

      {footer ? (
        <div
          className={cn(
            "bottom-0 z-10 border-t-2 border-lesson-option-border bg-lesson-surface",
            stickyFooter === "always" ? "sticky" : "sm:sticky"
          )}
        >
          <div className="mx-auto flex w-full max-w-4xl flex-col-reverse gap-3 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-6">
            {footer}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A labelled list of facts in a tactile panel (2px border, 16px corners). */
export function FactList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <dl
      className={cn(
        "flex flex-col divide-y-2 divide-lesson-option-border rounded-2xl border-2 border-lesson-option-border",
        className
      )}
    >
      {children}
    </dl>
  );
}

/** One row of a FactList: icon, label, value and an optional detail line. */
export function Fact({
  icon: Icon,
  label,
  children,
  detail,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  label: string;
  children: React.ReactNode;
  detail?: React.ReactNode;
}) {
  return (
    <div className="grid gap-x-4 gap-y-1 px-4 py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-start sm:px-5">
      <dt className="flex min-h-6 items-center gap-3 type-label-l font-bold text-lesson-muted">
        <Icon className="size-5 shrink-0" aria-hidden="true" />
        {label}
      </dt>
      <dd className="flex min-w-0 flex-col gap-1 pl-8 type-body-l text-lesson-on-surface wrap-break-word sm:pl-0">
        <span>{children}</span>
        {detail ? <span className="type-body-m text-lesson-muted">{detail}</span> : null}
      </dd>
    </div>
  );
}
