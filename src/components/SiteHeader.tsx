import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
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
} from "lucide-react";
import { enablePush } from "@/lib/push-client";
import { toast } from "sonner";

// One header used across the whole site so nav + branding are consistent.
// `right` lets account pages append their own actions (credits, sign out, …).
export function SiteHeader({ right }: { right?: ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const isUserAuthed = !!data.user;
      setAuthed(isUserAuthed);
      if (data.user) {
        const { data: adminRes } = await supabase.rpc("has_role", {
          _user_id: data.user.id,
          _role: "admin",
        });
        setIsAdmin(!!adminRes);
      }
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
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2.5 sm:px-4 md:px-6 md:py-3.5">
        <Link to="/" className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Heart className="h-5 w-5 shrink-0 fill-primary text-primary md:h-6 md:w-6" />
          <span className="font-display text-base font-semibold tracking-tight sm:text-lg md:text-xl text-foreground">
            HumanCrush.com
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
        <div className="flex items-center gap-1.5 md:hidden">
          {right}

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Open menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[85vw] max-w-xs border-white/10 bg-background/95 backdrop-blur-2xl p-6">
              <SheetHeader className="text-left border-b border-white/10 pb-4">
                <SheetTitle className="flex items-center gap-2">
                  <Heart className="h-5 w-5 fill-primary text-primary" />
                  <span className="font-display text-lg font-semibold">HumanCrush.com</span>
                </SheetTitle>
              </SheetHeader>

              <div className="mt-6 flex flex-col gap-2">
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

