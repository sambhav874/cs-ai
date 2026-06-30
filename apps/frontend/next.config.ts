import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// SECURITY: Derive the API origin for CSP connect-src from the env var.
// Falls back to 'self' so the app still works without the var set.
const apiOrigin = (() => {
  const raw = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL || "";
  try {
    return raw ? new URL(raw).origin : "";
  } catch {
    return "";
  }
})();

const cspDirectives = [
  "default-src 'self'",
  // 'unsafe-eval' needed by Next.js HMR in dev; 'unsafe-inline' required by Next.js App Router for RSC streaming/hydration
  `script-src 'self'${isDev ? " 'unsafe-eval'" : ""} 'unsafe-inline' https://www.googletagmanager.com`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://www.google-analytics.com https://www.googletagmanager.com",
  // In dev, allow localhost websocket (HMR) and all localhost HTTP origins
  `connect-src 'self'${apiOrigin ? " " + apiOrigin : ""}${isDev ? " ws://localhost:* http://localhost:*" : ""} https://api.stripe.com https://www.google-analytics.com https://region1.google-analytics.com https://analytics.google.com wss:`,
  "frame-src https://js.stripe.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  serverExternalPackages: ["@react-pdf/renderer"],
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
  outputFileTracingRoot: __dirname,
  images: {
    unoptimized: true,
  },
  turbopack: {
    resolveAlias: {
      canvas: './empty-module.ts',
    },
  },
  // redirect to handle signup route

  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: cspDirectives },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
