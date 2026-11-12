import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every route reads live chain state, so nothing is prerendered or cached.
  cacheComponents: false,
  serverExternalPackages: ["near-api-js"],
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
