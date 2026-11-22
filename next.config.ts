import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // receipts ride along as compressed data URLs; leave headroom for four
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
