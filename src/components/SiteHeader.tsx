import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Heart,
  Circle,
  Sparkles,
  Menu,
  Home,
  Image as ImageIcon,
  Compass,
  MessageSquare,
  Gem,
  History,
  DollarSign,
  Bell,
  Shield,
  LogOut,
  LogIn,
  HelpCircle,
  LifeBuoy,
  Mail,
} from "lucide-react";
import { enablePush } from "@/lib/push-client";
import { toast } from "sonner";
import { LanguageSelect } from "@/components/LanguageSelect";
import { openSupport } from "@/components/SupportWidget";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support-contact";
import { useSystemStatus } from "@/hooks/use-app-setting";

// Whether this session's user is an admin, asked once per page load rather than
// on every header mount. The header is on every page, and the role check is a
// database round trip that was running again on each navigation.
let adminCheck: { userId: string; promise: Promise<boolean> } | null = null;
function isAdminFor(userId: string): Promise<boolean> {
  if (adminCheck?.userId !== userId) {
    adminCheck = {
      userId,
      promise: (async () => {
        try {
          const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
          return !!data;
        } catch {
          return false;
        }
      })(),
    };
  }
  return adminCheck.promise;
}

// One header used across the whole site so nav + branding are consistent.
// `right` lets account pages append their own actions (credits, sign out, …).
// On a phone those move into the menu, which has no room for a live value like
// the credit balance — `mobileRight` is the one small thing that stays beside
// the menu button.
export function SiteHeader({ right, mobileRight }: { right?: ReactNode; mobileRight?: ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [open, setOpen] = useState(false);
  const systemStatus = useSystemStatus();

  // The session on this device, not a server validation of it — see the same
  // note in routes/index.tsx. It was the first of three round trips the header
  // made before it could decide which links to show.
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      setAuthed(!!user);
      if (user) setIsAdmin(await isAdminFor(user.id));
    });
  }, []);

  async function handleEnableNotifications() {
    try {
      const r = await enablePush();
      if (r === "enabled") toast.success("Notifications enabled — she'll ping you 💌");
      else if (r === "denied") toast.error("Notifications blocked in browser settings");
      else toast.error("Push notifications not supported on this browser");
    } catch {
      toast.error("Couldn't enable notifications");
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-2 py-2.5 sm:px-4 md:px-6 md:py-3.5">
        <Link to="/" className="flex shrink items-center gap-1.5 min-w-0 sm:gap-2">
          <Heart className="h-5 w-5 shrink-0 fill-primary text-primary md:h-6 md:w-6" />
          <span className="font-display text-[11px] sm:text-lg md:text-xl text-foreground truncate">
            HumanCrush<span className="hidden sm:inline">.com</span>
          </span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex shrink items-center gap-1">
          <Button asChild variant="ghost" size="sm" className="h-10 rounded-full px-3 text-sm">
            <Link to="/cams">
              <Circle className="mr-1 h-2 w-2 fill-red-500 text-red-500" /> Live
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="h-10 rounded-full px-3 text-sm">
            <Link to="/gallery">Gallery</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="h-10 rounded-full px-3 text-sm">
            <Link to="/browse">Browse</Link>
          </Button>
          <Button
            asChild
            size="sm"
            className="h-10 rounded-full bg-grad-primary px-3.5 text-sm text-primary-foreground shadow-glow"
          >
            <Link to="/create">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Create
            </Link>
          </Button>
          {authed ? (
            <Button asChild variant="ghost" size="sm" className="h-10 rounded-full px-3 text-sm">
              <Link to="/me">My chats</Link>
            </Button>
          ) : (
            <Button asChild variant="ghost" size="sm" className="h-10 rounded-full px-3 text-sm">
              <Link to="/auth" search={{ mode: "signin" } as any}>
                Sign in
              </Link>
            </Button>
          )}
          {right}
        </nav>

        {/* Mobile Navigation Controls */}
        <div className="flex items-center gap-1.5 md:hidden shrink-0">
          {mobileRight}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="tap-exempt h-9 w-9 min-w-0 rounded-full"
              >
                <Menu className="h-5 w-5" />
                <span className="sr-only">Open menu</span>
              </Button>
            </SheetTrigger>
            {/* p-0 and a flex column, so the links below can scroll.
                The sheet is fixed at h-full with p-6 and no overflow rule, so
                on a phone every entry past the fold was simply unreachable —
                the menu is taller than a 640px screen. The header stays put
                and only the list moves. */}
            <SheetContent
              side="right"
              className="flex w-[85vw] max-w-xs flex-col gap-0 overflow-hidden border-white/10 bg-background/95 p-0 backdrop-blur-2xl"
            >
              <SheetHeader className="shrink-0 border-b border-white/10 px-6 pb-4 pt-6 text-left">
                <SheetTitle className="flex items-center gap-2">
                  <Heart className="h-5 w-5 fill-primary text-primary" />
                  <span className="font-display text-lg font-semibold">HumanCrush.com</span>
                </SheetTitle>
              </SheetHeader>

              {/* overscroll-contain stops a flick at the end of the list from
                  scrolling the page underneath; the safe-area padding clears
                  the phone's home indicator. */}
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6">
                <Link
                  to="/"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition hover:bg-white/5"
                >
                  <Home className="h-4 w-4 text-primary" /> Home
                </Link>
                <Link
                  to="/cams"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition hover:bg-white/5"
                >
                  <Circle className="h-2 w-2 fill-red-500 text-red-500" /> Live Cams
                </Link>
                <Link
                  to="/gallery"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition hover:bg-white/5"
                >
                  <ImageIcon className="h-4 w-4 text-primary" /> Gallery
                </Link>
                <Link
                  to="/browse"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition hover:bg-white/5"
                >
                  <Compass className="h-4 w-4 text-primary" /> Browse Companions
                </Link>
                <Link
                  to="/create"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-xl bg-grad-primary/10 border border-primary/20 px-3 py-2.5 text-sm font-semibold text-primary transition hover:bg-grad-primary/20"
                >
                  <Sparkles className="h-4 w-4" /> Create Companion
                </Link>
                {authed && (
                  <Link
                    to="/me"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition hover:bg-white/5"
                  >
                    <MessageSquare className="h-4 w-4 text-primary" /> My Chats
                  </Link>
                )}
                <Link
                  to="/credits"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition hover:bg-white/5"
                >
                  <Gem className="h-4 w-4 text-amber-400" /> Buy Credits / Premium
                </Link>
                {authed && (
                  <Link
                    to="/history"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition hover:bg-white/5"
                  >
                    <History className="h-4 w-4 text-primary" /> Chat History
                  </Link>
                )}
                <Link
                  to="/affiliate"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition hover:bg-white/5"
                >
                  <DollarSign className="h-4 w-4 text-emerald-400" /> Earn / Affiliate
                </Link>
                <Link
                  to="/faq"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition hover:bg-white/5"
                >
                  <HelpCircle className="h-4 w-4 text-primary" /> Help Center
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    // The widget is mounted on every page but a conversation;
                    // there it is not, so the home page's copy answers instead.
                    if (window.location.pathname.startsWith("/chat/")) {
                      window.location.href = "/?support=1";
                      return;
                    }
                    openSupport();
                  }}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition hover:bg-white/5"
                >
                  <LifeBuoy className="h-4 w-4 text-primary" /> Help &amp; support
                </button>
                <a
                  href={supportMailto()}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition hover:bg-white/5"
                >
                  <Mail className="h-4 w-4 text-primary" />
                  <span className="min-w-0">
                    <span className="block">Email support</span>
                    <span className="block truncate text-[11px] font-normal text-white/50">
                      {SUPPORT_EMAIL}
                    </span>
                  </span>
                </a>

                {authed && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      handleEnableNotifications();
                    }}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition hover:bg-white/5 text-left text-muted-foreground hover:text-foreground"
                  >
                    <Bell className="h-4 w-4 text-primary" /> Enable Push Notifications
                  </button>
                )}

                {isAdmin && (
                  <Link
                    to="/admin"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition hover:bg-white/5 text-amber-400"
                  >
                    <Shield className="h-4 w-4" /> Admin Console
                  </Link>
                )}

                <div className="mt-3 border-t border-white/10 pt-3">
                  <LanguageSelect compact />
                </div>
                {systemStatus && (
                  <p className="px-1 text-[10px] leading-snug text-white/40">
                    <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" />
                    {systemStatus}
                  </p>
                )}

                <div className="mt-4 pt-4 border-t border-white/10">
                  {authed ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setOpen(false);
                        handleSignOut();
                      }}
                      className="w-full justify-start gap-2 rounded-xl border-white/10"
                    >
                      <LogOut className="h-4 w-4" /> Sign Out
                    </Button>
                  ) : (
                    <Button
                      asChild
                      className="w-full justify-start gap-2 rounded-xl bg-grad-primary text-primary-foreground"
                      onClick={() => setOpen(false)}
                    >
                      <Link to="/auth" search={{ mode: "signin" } as any}>
                        <LogIn className="h-4 w-4" /> Sign In
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
