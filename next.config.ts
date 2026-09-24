import type { NextConfig } from "next";

// A static export: the app runs entirely in the browser against Supabase (row-level security keeps each
// account's rows private), so there's no server to run. `npm run build` writes the site to out/ and then
// generates the service worker that caches it for offline use.
const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
};

export default nextConfig;
