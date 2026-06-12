"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface LoadingScreenProps {
  message?: string;
  className?: string;
  compact?: boolean;
}

const LoadingScreen = ({
  message = "Loading your workspace...",
  className,
  compact = false,
}: LoadingScreenProps) => {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex w-full items-center justify-center px-6 py-8 text-gray-900",
        compact ? "min-h-32" : "min-h-64",
        className,
      )}
    >
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="absolute inset-2 rounded-xl bg-gray-50" />
          <svg className="relative h-6 w-6 animate-spin text-gray-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>

        {message && (
          <p className="mt-4 text-sm font-medium text-gray-700">
            {message}
          </p>
        )}

        <div className="mt-5 w-full max-w-[220px] space-y-2">
          <div className="h-2 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full w-1/2 rounded-full bg-gray-900/80 motion-safe:animate-[loading-bar_1.1s_ease-in-out_infinite]" />
          </div>
          <div className="mx-auto h-2 w-2/3 rounded-full bg-gray-100" />
        </div>
      </div>

      <style jsx>{`
        @keyframes loading-bar {
          0% {
            transform: translateX(-110%);
          }
          55% {
            transform: translateX(60%);
          }
          100% {
            transform: translateX(220%);
          }
        }
      `}</style>
    </div>
  );
};

export default LoadingScreen;
