"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--inverse-surface)",
          "--normal-text": "var(--inverse-on-surface)",
          "--normal-border": "transparent",
          "--border-radius": "var(--radius-sm)",
        } as React.CSSProperties
      }
      toastOptions={{
        closeButtonAriaLabel: "Dismiss",
        classNames: {
          toast: "cn-toast type-body-m shadow-lg pr-12!",
          actionButton: "bg-transparent! text-inverse-primary! font-medium!",
          cancelButton: "bg-transparent! text-inverse-on-surface!",
          // M3 snackbar close: a 32px icon button inside the trailing edge,
          // not sonner's 20px badge on the corner.
          closeButton:
            "top-1/2! right-2! left-auto! size-8! -translate-y-1/2! transform-none! border-0! bg-transparent! text-inverse-on-surface! [--focus-ring-color:var(--inverse-primary)] hover:bg-inverse-on-surface/10! [&_svg]:size-4",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
