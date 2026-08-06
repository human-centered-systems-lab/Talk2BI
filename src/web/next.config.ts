import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The Databricks driver loads thrift definitions and native kernel bindings
  // at runtime, so it must not be bundled.
  serverExternalPackages: ["@databricks/sql"],
  // There is no landing page: `/` sends visitors straight to the chat. Signed-out
  // visitors are then bounced on to /auth/login by the auth proxy, so this stays
  // a single rule rather than duplicating the auth check here.
  //
  // Deliberately not permanent — a 308 is cached hard by browsers and would be
  // painful to undo if a marketing page ever lands on `/`.
  async redirects() {
    return [{ source: "/", destination: "/chat", permanent: false }];
  },
};

export default nextConfig;
