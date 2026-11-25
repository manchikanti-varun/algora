import type { NextConfig } from "next";

// The browser only ever talks to the Vercel origin. /api/v1/* is proxied to Railway, so the session cookie is first-party.
// BACKEND_URL is read at BUILD time (rewrites are compiled into the build).
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:5100";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const isDev = process.env.NODE_ENV === "development";

// Fail the Vercel production build instead of shipping a frontend that silently points at localhost or cannot sign in.
if (process.env.VERCEL_ENV === "production") {
  const problems = [
    !process.env.BACKEND_URL && "BACKEND_URL is not set",
    process.env.BACKEND_URL && !process.env.BACKEND_URL.startsWith("https://") && "BACKEND_URL must be https:// in production",
    !GOOGLE_CLIENT_ID && "NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set",
  ].filter(Boolean);
  if (problems.length) throw new Error(`Algora production build refused:\n  - ${problems.join("\n  - ")}`);
}

// Google Identity Services needs its client script, iframe, style sheet and XHR endpoint (accounts.google.com/gsi/*).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "img-src 'self' blob: data: https://lh3.googleusercontent.com",
  "font-src 'self'",
  "connect-src 'self' https://accounts.google.com/gsi/",
  "frame-src https://accounts.google.com/gsi/",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // FedCM ("identity-credentials-get") is used by Google sign-in; everything else is off.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), identity-credentials-get=(self \"https://accounts.google.com\")" },
  // Google's sign-in popup needs to talk back to this window.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } },
  },
  webpack(config) {
    // Run the same Tailwind transform for the optional --webpack build.
    config.module.rules.push({ test: /globals\.css$/, enforce: "pre", use: "@tailwindcss/turbopack" });
    return config;
  },
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${BACKEND_URL}/api/v1/:path*` }];
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};
export default nextConfig;
