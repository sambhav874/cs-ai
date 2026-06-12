import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function cx(...inputs: any[]) {
  return twMerge(clsx(...inputs))
}

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"


export const focusInput =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"

export const hasErrorInput =
  "aria-invalid:ring-2 aria-invalid:ring-red-200 aria-invalid:border-red-500 dark:aria-invalid:ring-red-400/20 dark:aria-invalid:border-red-500"
