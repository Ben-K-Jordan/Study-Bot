import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-24 w-full resize-none rounded-md border border-input bg-transparent px-4 py-3 text-base text-on-surface transition-colors outline-none placeholder:text-muted-foreground hover:border-on-surface focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive disabled:cursor-not-allowed disabled:opacity-38",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
