import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// Hosting compresses every response at the edge. Never compress a body (gzip, brotli,
// CompressionStream) or set content-encoding here or in a server route: the body gets encoded
// twice and renders garbled.

/**
 * The Content-Security-Policy for the app shell.
 *
 * 'unsafe-inline' on script-src is a real trade-off: TanStack Start serialises
 * hydration state into inline <script> tags, so a nonce would have to be
 * threaded through the router. Inline *styles* are required by Tailwind's
 * runtime and GSAP. Everything else is locked down: no third-party scripts, no
 * objects, no framing, and network access limited to this origin, the API and
 * Supabase.
 */
function contentSecurityPolicy(): string {
  const api = (import.meta.env["VITE_API_URL"] as string | undefined)?.trim();
  const supabase = (import.meta.env["VITE_SUPABASE_URL"] as string | undefined)?.trim();
  const connect = [
    "'self'",
    api,
    supabase,
    "https://*.supabase.co",
    "wss://*.supabase.co",
    import.meta.env.DEV ? "ws://localhost:* http://localhost:*" : "",
  ].filter(Boolean);
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "script-src 'self' 'unsafe-inline'",
    `connect-src ${connect.join(" ")}`,
    // Only outside dev: the directive rewrites http asset URLs to https, which
    // is exactly wrong for a local dev server on http://localhost:8080.
    import.meta.env.DEV ? "" : "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");
}

/** Headers the browser needs to refuse the things this app never does. */
function securityHeaders(): Record<string, string> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    // HSTS only means anything over https; harmless on http localhost.
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  };
}

function withSecurityHeaders(response: Response): Response {
  const out = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  for (const [name, value] of Object.entries(securityHeaders())) {
    out.headers.set(name, value);
  }
  return out;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
