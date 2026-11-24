import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow an isolated build/dev check alongside an existing local server.
  distDir: process.env.CAREPLAN_DIST_DIR || ".next",
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
