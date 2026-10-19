import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Lock, Sparkles, MessageSquare, Gem } from "lucide-react";

export function BottomNav() {
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  // Hide bottom tab bar on active chat room pages so the chat input form is completely unobstructed
  if (pathname.startsWith("/chat/")) return null;

  const items = [
    { href: "/", label: "Home", icon: Home, active: pathname === "/" },
    { href: "/cams", label: "Private", icon: Lock, active: pathname.startsWith("/cams") || pathname.startsWith("/gallery") },
    { href: "/create", label: "Create", icon: Sparkles, active: pathname.startsWith("/create"), highlight: true },
    { href: "/me", label: "Chat", icon: MessageSquare, active: pathname.startsWith("/me") || pathname.startsWith("/companion") || pathname.startsWith("/chat") },
    { href: "/credits", label: "Premium", icon: Gem, active: pathname.startsWith("/credits"), gold: true },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-background/95 backdrop-blur-xl lg:hidden">
      <nav className="mx-auto flex max-w-md items-center justify-around px-2 py-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              to={item.href}
              className={`flex flex-col items-center gap-1 rounded-xl px-3 py-1 text-[11px] font-medium transition-all ${
                item.active
                  ? item.gold
                    ? "text-amber-400 font-semibold"
                    : "text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <div
                className={`relative flex items-center justify-center ${
                  item.highlight
                    ? "rounded-full bg-grad-primary p-2 text-primary-foreground shadow-glow"
                    : ""
                }`}
              >
                <Icon
                  className={`h-5 w-5 ${
                    item.gold && item.active ? "text-amber-400 fill-amber-400/20" : ""
                  } ${item.active && !item.highlight ? "fill-primary/20" : ""}`}
                />
              </div>
              <span className={item.highlight ? "text-primary font-semibold" : ""}>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
