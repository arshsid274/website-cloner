import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright is a heavy native dep — keep it external to the server bundle
  // so Next doesn't try to trace/bundle Chromium's node bindings.
  serverExternalPackages: ["playwright", "playwright-core"],
};

export default nextConfig;
