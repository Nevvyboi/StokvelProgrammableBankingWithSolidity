import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // the stage app reads the Foundry deployment file at runtime; nothing here needs telemetry
  typedRoutes: false,
  agentRules: false,
  devIndicators: false,
  // the projector, the signing laptop and the presenter's phone all reach the dev server by IP
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.local", "192.168.*.*", "10.*.*.*", "172.*.*.*"],
};

export default nextConfig;
