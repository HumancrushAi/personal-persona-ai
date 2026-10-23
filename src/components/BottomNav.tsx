import { Link, useRouterState } from "@tanstack/react-router";
import { Compass, Copy, MessageCircle, Sparkles, SquarePlus } from "lucide-react";
import { useEffect, useState } from "react";

const MOBILE_NAV_HEIGHT = "calc(64px + env(safe-area-inset-bottom))";

/**
 * The mobile information architecture is deliberately limited to the five
 * destinations people use most. Secondary routes remain available from the
 * site menu, so the tab bar never becomes a tiny duplicate sitemap.
 */
export function BottomNav() {
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;
  const [editingPrompt, setEditingPrompt] = useState(false);
  const activeChat = pathname.startsWith("/chat/");

  useEffect(() => {
    const isPrompt = (target: EventTarget | null) => target instanceof HTMLTextAreaElement;
    const syncFocus = () => setEditingPrompt(isPrompt(document.activeElement));
    const onFocusIn = (event: FocusEvent) => { if (isPrompt(event.target)) setEditingPrompt(true); };
    const onFocusOut = () => window.setTimeout(syncFocus, 0);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    syncFocus();
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  const visible = !activeChat && !editingPrompt;

  useEffect(() => {
    document.documentElement.style.setProperty("--hc-mobile-nav-offset", visible ? MOBILE_NAV_HEIGHT : "0px");
    return () => document.documentElement.style.setProperty("--hc-mobile-nav-offset", "0px");
  }, [visible]);

  if (!visible) return null;

  const items = [
    { href: "/browse", label: "Explore", icon: Compass, active: pathname.startsWith("/browse") || pathname.startsWith("/models") || pathname === "/" },
    { href: "/me", label: "Chat", icon: MessageCircle, active: pathname.startsWith("/me") || pathname.startsWith("/companion") || pathname.startsWith("/chat") },
    { href: "/create", label: "Create", icon: SquarePlus, active: pathname === "/create" || pathname.startsWith("/companion/") },
    { href: "/create-media", label: "Generate", icon: Sparkles, active: pathname.startsWith("/create-media") },
    { href: "/library", label: "My AI", icon: Copy, active: pathname.startsWith("/library") },
  ];

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-white/[0.12] bg-[#101012]/92 backdrop-blur-xl lg:hidden">
      <nav aria-label="Primary" className="mx-auto flex min-h-16 max-w-md items-stretch justify-between px-1 pb-[env(safe-area-inset-bottom)] pt-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              to={item.href}
              aria-current={item.active ? "page" : undefined}
              className={`flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[12px] font-medium transition ${item.active ? "text-white" : "text-[#A1A1AA] hover:text-white"}`}
            >
              <Icon className="h-6 w-6" strokeWidth={item.active ? 2.4 : 1.9} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
