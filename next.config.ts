import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
  outputFileTracingIncludes: { "/api/**": ["./data/packet.json", "./data/packet-rerun.json"] },
};

export default nextConfig;
