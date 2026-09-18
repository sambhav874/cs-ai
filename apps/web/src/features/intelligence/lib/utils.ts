import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function cx(...inputs: any[]) {
  return twMerge(clsx(...inputs))
}

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 "


export const focusInput =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 "

export const hasErrorInput =
  "aria-invalid:ring-2 aria-invalid:ring-risk-200 aria-invalid:border-risk-600  "
