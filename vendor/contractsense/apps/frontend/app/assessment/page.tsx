"use client";

import React, { useEffect } from "react";
import Head from "next/head";

export default function AssessmentPage() {
  useEffect(() => {
    // Check if the Tally script is already present
    if (document.querySelector('script[src="https://tally.so/widgets/embed.js"]')) {
      // If script is already there, just reload the embeds
      if (typeof (window as any).Tally !== "undefined") {
        (window as any).Tally.loadEmbeds();
      }
      return;
    }

    // If the script is not present, create and append it
    const script = document.createElement("script");
    script.src = "https://tally.so/widgets/embed.js";
    script.async = true;
    script.onload = () => {
      // Once the script is loaded, load the embeds
      if (typeof (window as any).Tally !== "undefined") {
        (window as any).Tally.loadEmbeds();
      }
    };
    script.onerror = () => {
      console.error("Failed to load Tally embeds script.");
    };

    document.body.appendChild(script);

    // Cleanup function to remove the script when the component unmounts
    return () => {
      if (script.parentNode) {
        document.body.removeChild(script);
      }
    };
  }, []);

  return (
    <>
      <Head>
        <title>Risk Assessment</title>
      </Head>
      <div className="bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div>
            <iframe
               data-tally-src="https://tally.so/embed/nreNr2?alignLeft=1&transparentBackground=1&dynamicHeight=1"
              width="100%"
              height="1200"
              title="Risk Assessment"
            ></iframe>
          </div>
        </div>
      </div>
    </>
  );
}