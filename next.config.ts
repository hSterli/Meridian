import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : "";
const supabaseWss = supabaseOrigin.replace(/^https:/, "wss:");

// No nonces: this app has no third-party scripts and Tailwind/inline `style=`
// attributes (progress bars) need 'unsafe-inline' for style-src regardless.
// Nonces would also force every page into dynamic rendering for no real gain
// here. See node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md.
//
// `upgrade-insecure-requests` and HSTS are production-only: the dev server is
// plain HTTP with no TLS listener. HSTS in particular is dangerous to send in
// dev — the browser caches "always use HTTPS for this host" for the given
// max-age and then refuses to load http://localhost at all until that's
// manually cleared, since there's nothing serving HTTPS to redirect to.
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self';
  connect-src 'self' ${supabaseOrigin} ${supabaseWss};
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  ${isDev ? "" : "upgrade-insecure-requests;"}
`
  .replace(/\s{2,}/g, " ")
  .trim();

const securityHeaders = [
  { key: "Content-Security-Policy", value: cspHeader },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  ...(isDev
    ? []
    : [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]),
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
