"use client"

import { useEffect } from "react"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"

// This function ensures GSAP is properly initialized
export function useGSAPInit() {
  useEffect(() => {
    // Only register once on the client side
    if (typeof window !== "undefined") {
      gsap.registerPlugin(ScrollTrigger)

      // Refresh ScrollTrigger when the page is fully loaded
      // This helps with any layout shifts that might occur
      window.addEventListener("load", () => {
        ScrollTrigger.refresh()
      })

      // Refresh on resize to handle responsive layout changes
      let resizeTimer: NodeJS.Timeout
      const handleResize = () => {
        clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => {
          ScrollTrigger.refresh()
        }, 250)
      }

      window.addEventListener("resize", handleResize)

      return () => {
        window.removeEventListener("load", () => ScrollTrigger.refresh())
        window.removeEventListener("resize", handleResize)
      }
    }
  }, [])
}
