import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // In production, export as static HTML/CSS/JS (served by the backend)
  // In development, use Next.js dev server with API proxying
  ...(isProd ? { output: "export" } : {}),

  // Increase proxy timeout for long-running browser automation tasks (default is ~30s)
  experimental: {
    proxyTimeout: 5 * 60 * 1000, // 5 minutes
  },

  // Fix Turbopack root detection — without this, it picks up the parent
  // youbot-core/package-lock.json and resolves pages relative to the wrong dir
  turbopack: {
    root: __dirname,
  },


  // Rewrites only work in dev mode (not with static export)
  ...(!isProd
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: `${process.env.YOUBOT_API_URL || "http://localhost:5081"}/api/:path*`,
            },
            {
              source: "/health",
              destination: `${process.env.YOUBOT_API_URL || "http://localhost:5081"}/health`,
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;
