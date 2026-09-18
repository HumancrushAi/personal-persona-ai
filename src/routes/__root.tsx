import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
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

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
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
          "Build the AI girlfriend you've always imagined — 25 stunning companions, fully customizable personality.",
      },
      { property: "og:title", content: "HumanCrush.com — Your AI Companion, Designed by You" },
      {
        property: "og:description",
        content:
          "Build the AI girlfriend you've always imagined — 25 stunning companions, fully customizable personality.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
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
import { Analytics } from "@vercel/analytics/react";

// The support widget's floating button sits on the landing page and the sign-up
// page only.
//
// It is a button in the bottom-right, which is where the chat composer, the
// send control and the media buttons also live — on a conversation it covers
// the app rather than helping. It also reads as a support desk hovering over an
// intimate conversation, which is the wrong note in the wrong place.
//
// The widget itself is mounted everywhere except a conversation, the admin
// console and the studio, invisible until "Help & support" in the menu opens
// it. Support used to be reachable from exactly two pages; the account page,
// where billing questions actually arise, was not one of them.
const SUPPORT_BUBBLE_PATHS = ["/", "/auth"];
const NO_SUPPORT_PREFIXES = ["/chat/", "/admin", "/studio"];

// The footer carries the policies, support and the 18+ notice on every page
// and every screen size. Not on a conversation (a full-height app screen with
// its own composer at the bottom) or the admin console and studio, which are
// tools rather than pages.
const NO_FOOTER_PREFIXES = ["/chat/", "/admin", "/studio"];

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Trailing slashes are normalised so "/auth/" matches too.
  const path = pathname.replace(/(.)\/+$/, "$1");
  const supportBubble = SUPPORT_BUBBLE_PATHS.includes(path);
  const supportMounted = !NO_SUPPORT_PREFIXES.some((p) => path.startsWith(p));
  const showFooter = !NO_FOOTER_PREFIXES.some((p) => path.startsWith(p));

  useEffect(() => {
    autoSubscribePushIfGranted();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
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
      {/* Page views and referrers, so "where does the traffic come from" has
          an answer. Vercel's own analytics: no cross-site profile, no cookie,
          and it only records once Web Analytics is switched on for the project
          in the Vercel dashboard. */}
      <Analytics />
    </QueryClientProvider>
  );
}
