/**
 * Hand-written adapter (the port script leaves it alone): ContractSense's
 * progress bar was Radix's, which this app does not ship. A div does the job.
 */
import * as React from "react"

import { cn } from "@cs/lib/utils"

type ProgressProps = React.HTMLAttributes<HTMLDivElement> & { value?: number | null }

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(({ className, value, ...props }, ref) => {
  const pct = Math.max(0, Math.min(100, value ?? 0))
  return (
    <div
      ref={ref}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-primary/20", className)}
      {...props}
    >
      <div className="h-full w-full flex-1 bg-primary transition-transform duration-150" style={{ transform: `translateX(-${100 - pct}%)` }} />
    </div>
  )
})
Progress.displayName = "Progress"

export { Progress }
