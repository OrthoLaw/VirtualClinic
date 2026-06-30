/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium-min"],
  // A parent lockfile exists in the home dir; pin tracing root to this project.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
