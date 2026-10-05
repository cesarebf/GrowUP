import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  logging: { incomingRequests: false, serverFunctions: false },
  async headers() {
    return ["/account/:path*", "/auth/:path*", "/sign-in", "/sign-up", "/forgot-password", "/verify-email", "/invite/:path*", "/c/:path*", "/communities/:path*"].map((source) => ({
      source,
      headers: [
        { key: "Cache-Control", value: "private, no-store, max-age=0" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Robots-Tag", value: "noindex, nofollow, nosnippet" },
      ],
    }));
  },
};

export default nextConfig;
