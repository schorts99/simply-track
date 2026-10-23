import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: { position: "top-left" },
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  async headers() {
    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    ];
    if (process.env.NODE_ENV === "production") security.push({
      key: "Content-Security-Policy",
      value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://accounts.google.com; style-src 'self' 'unsafe-inline' https://accounts.google.com; connect-src 'self' https://www.googleapis.com https://accounts.google.com https://oauth2.googleapis.com; frame-src https://accounts.google.com; img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    });
    return [
      { source: "/:path*", headers: security },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/" }] },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
