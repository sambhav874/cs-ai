"use client"

export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || ""

type GtagCommand = "config" | "event" | "js" | "set"

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (command: GtagCommand, targetId: string | Date, config?: Record<string, unknown>) => void
  }
}

export function pageview(url: string) {
  if (!GA_MEASUREMENT_ID || typeof window.gtag !== "function") return

  window.gtag("config", GA_MEASUREMENT_ID, {
    page_path: url,
  })
}

export function event(action: string, params: Record<string, unknown> = {}) {
  if (!GA_MEASUREMENT_ID || typeof window.gtag !== "function") return

  window.gtag("event", action, params)
}

export function getGaClientId() {
  if (typeof document === "undefined") return undefined

  const gaCookie = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith("_ga="))

  const value = gaCookie?.split("=")[1]
  if (!value) return undefined

  const parts = value.split(".")
  if (parts.length >= 4) {
    return `${parts[2]}.${parts[3]}`
  }

  return value
}
