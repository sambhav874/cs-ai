"use client";

import { useEffect, useState } from "react";

export default function LoadingScreen() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let mounted = true;

    const tick = () => {
      if (!mounted) return;

      setProgress((prev) => {
        if (prev >= 92) return prev;

        // Random jump: smaller and rarer as we go higher
        const maxJump = Math.max(2, 14 - prev * 0.12);
        const jump = Math.random() * maxJump;
        const next = Math.min(prev + jump, 92);

        // Schedule next tick with random delay
        const delay = 180 + Math.random() * 420 + (next > 70 ? 300 : 0);
        timer = setTimeout(tick, delay);

        return next;
      });
    };

    // Initial burst — a few quick jumps to get going
    let timer = setTimeout(tick, 300);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <img src="/logo.png" alt="ContractSense" className="h-10 w-10 animate-pulse" />
        <div className="h-1 w-32 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
