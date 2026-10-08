import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { AffiliateTracker } from "../components/AffiliateTracker";
import { reportLovableError } from "../lib/lovable-error-reporting";

// The admin shortcut that used to live here is gone. It was mounted at the root,
// so it rendered on EVERY route — including the three in NO_FOOTER_PREFIXES,
// which exist precisely because /chat, /admin and /studio are full-height
// layouts that a trailing block breaks. SiteFooter honoured that list; this one
// was mounted outside the guard and did not, so an admin on a phone got an
// extra footer with pb-20 shoved under a chat screen that had deliberately
// suppressed its footer.
//
// The console is reached from the hamburger menu on mobile (SiteHeader's sheet,
// already gated on isAdmin) and from /me on desktop, where the sheet is
// md:hidden. Both are admin-only, and neither is in the page flow.

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "HumanCrush.com — Your AI Companion, Designed by You" },
      {
        name: "description",
        content:
          "Chat with realistic AI girlfriends and AI boyfriends — selfies, voice notes and live video, or design your own companion. 25 free messages, no card.",
      },
      { property: "og:title", content: "HumanCrush.com — Your AI Companion, Designed by You" },
      {
        property: "og:description",
        content:
          "Chat with realistic AI girlfriends and AI boyfriends — selfies, voice notes and live video, or design your own companion. 25 free messages, no card.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "HumanCrush" },
      { property: "og:image", content: "https://www.humancrush.com/hero-banner.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://www.humancrush.com/hero-banner.png" },
      { name: "rating", content: "adult" },
    ],
    // Who the site is, for search and AI answer engines, on every page.
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": "https://www.humancrush.com/#org",
              name: "HumanCrush",
              url: "https://www.humancrush.com",
              logo: "https://www.humancrush.com/logo.png",
            },
            {
              "@type": "WebSite",
              "@id": "https://www.humancrush.com/#site",
              name: "HumanCrush",
              url: "https://www.humancrush.com",
              publisher: { "@id": "https://www.humancrush.com/#org" },
            },
          ],
        }),
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/favicon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

import { BottomNav } from "../components/BottomNav";
import { SiteFooter } from "../components/SiteFooter";
import { SupportWidget } from "../components/SupportWidget";
import { PushNotificationPrompt } from "../components/PushNotificationPrompt";
import { autoSubscribePushIfGranted } from "../lib/push-client";
import { initGoogleTranslate } from "../lib/languages";
import { Analytics } from "@vercel/analytics/react";

const SUPPORT_BUBBLE_PATHS = ["/", "/auth"];
const NO_SUPPORT_PREFIXES = ["/chat/", "/admin", "/studio"];
const NO_FOOTER_PREFIXES = ["/chat/", "/admin", "/studio"];

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Trailing slashes are normalised so "/auth/" matches too.
  const path = pathname.replace(/(.)\/+$/, "$1");
  const supportBubble = SUPPORT_BUBBLE_PATHS.includes(path);
  const supportMounted = !NO_SUPPORT_PREFIXES.some((p) => path.startsWith(p));
  const showFooter = !NO_FOOTER_PREFIXES.some((p) => path.startsWith(p));

  // Initialize translation and push on mount
  useEffect(() => {
    autoSubscribePushIfGranted();
    initGoogleTranslate();
  }, []);

  // Ensure every route load/navigation starts from the top of the site
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  }, [pathname]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Hide native Google Translate banner frame cleanly */}
      <style>{`
        .goog-te-banner-frame, .goog-te-balloon-frame, #goog-gt-tt, .goog-te-spinner-pos {
          display: none !important;
        }
        body {
          top: 0px !important;
          position: static !important;
        }
        .goog-tooltip, .goog-tooltip:hover {
          display: none !important;
        }
        .goog-text-highlight {
          background-color: transparent !important;
          box-shadow: none !important;
        }
        #google_translate_element {
          display: none !important;
        }
      `}</style>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      {/* The home page has a fixed 256px sidebar on large screens, and the
          footer is mounted outside that page's content column — without the
          inset its left edge would sit underneath the sidebar. */}
      {showFooter && <SiteFooter className={path === "/" ? "lg:pl-64" : ""} />}
      {/* Renders nothing. Here rather than on the landing page because an
          affiliate link can point at any page, and a ?ref= that only works on
          "/" quietly loses money on every deep link someone shares. */}
      <AffiliateTracker />
      <BottomNav />
      <PushNotificationPrompt />
      {supportMounted && <SupportWidget floating={supportBubble} />}
      <Toaster richColors position="top-center" />
      {/* Page views and referrers */}
      <Analytics />
    </QueryClientProvider>
  );
}

