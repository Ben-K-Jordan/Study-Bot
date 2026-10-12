// next dev needs eval for fast refresh; production builds do not.
const isDev = process.env.NODE_ENV !== "production"

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // pdf-parse v1 picks its pdf.js build with a dynamic require, which a bundler
  // cannot follow, so it is loaded from node_modules at runtime instead.
  serverExternalPackages: ["pdf-parse"],
  // Keep `next dev` from writing an AGENTS.md file into the project root.
  agentRules: false,
  // The dev-mode badge overlaps the navigation rail in screenshots.
  devIndicators: false,
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "X-DNS-Prefetch-Control", value: "on" },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
            // Fonts are self-hosted from @fontsource packages
            "style-src 'self' 'unsafe-inline'",
            "font-src 'self'",
            "img-src 'self' data: blob:",
            "connect-src 'self' https://www.googleapis.com https://oauth2.googleapis.com",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join("; "),
        },
      ],
    },
  ],
}

module.exports = nextConfig
