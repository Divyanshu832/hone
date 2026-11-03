import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // The dev badge sits over the sidebar theme switch.
  devIndicators: false,
  cacheComponents: true,
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
