'use client'

import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"
import { cn } from "@/lib/utils"

const LocalMarkerToggle = () => {
  const [useLocalMarker, setUseLocalMarker] = React.useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem("useLocalMarker");
      return stored ? JSON.parse(stored) : false;
    }
    return false;
  });

  const handleToggleChange = (checked: boolean) => {
    setUseLocalMarker(checked);
    localStorage.setItem("useLocalMarker", JSON.stringify(checked));
  };
 
  return (
    <div className="flex items-center gap-2">
      {process.env.NEXT_PUBLIC_BRANCH_ENV === 'development' && (
        <>
      <Switch
        checked={useLocalMarker}
        onCheckedChange={handleToggleChange}
        className={cn(
          "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          "data-[state=checked]:bg-black data-[state=unchecked]:bg-gray-200"
        )}
      >
        <SwitchThumb className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform",
          "data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
        )} />
        </Switch>
      <span className="text-sm flex flex-wrap font-medium text-gray-600 hidden md:inline">
        Use Marker Locally
      </span>
      </>
      )}
    </div>
  )
}

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      className
    )}
    {...props}
    ref={ref}
  />
))
Switch.displayName = SwitchPrimitives.Root.displayName

const SwitchThumb = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Thumb>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Thumb>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Thumb
    ref={ref}
    className={cn(
      "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
      className
    )}
    {...props}
  />
))
SwitchThumb.displayName = SwitchPrimitives.Thumb.displayName

export { LocalMarkerToggle }