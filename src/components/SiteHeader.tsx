import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Circle,
  Sparkles,
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
  ChevronDown,
  Venus,
  Mars,
  Users,
} from "lucide-react";
import { enablePush } from "@/lib/push-client";
import { toast } from "sonner";
import { LanguageSelect } from "@/components/LanguageSelect";
import { openSupport } from "@/components/SupportWidget";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support-contact";
import { useSystemStatus } from "@/hooks/use-app-setting";
import { LogoLink } from "@/components/Logo";

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

// The gender the visitor is browsing. The home page owns the live value; every
// other page reads the last choice from here, so the ♀/♂ on the menu button
// matches what the home page will show.
export type Gender = "girls" | "guys";
const GENDER_KEY = "hc:gender";
export function readGender(): Gender {
  try {
    return localStorage.getItem(GENDER_KEY) === "guys" ? "guys" : "girls";
  } catch {
    return "girls";
  }
}
export function storeGender(g: Gender) {
  try {
    localStorage.setItem(GENDER_KEY, g);
  } catch {
    /* private mode: the choice just isn't remembered */
  }
}

// One header for the whole site, on one line at every width, laid out like
// candy.ai's: logo, a ♀⌄ button that opens the menu, then language, Login and
// Join Free. At 360px that is about 300px of the 336 available.
// `right` lets account pages append their own actions on desktop; on a phone
// `mobileRight` is the one small thing that stays beside the language flag.
// `home` is the landing page: it has its own sidebar on large screens, so there
// the bar drops the logo and links at lg and shows the Girls / Guys tabs.
export function SiteHeader({
  right,
  mobileRight,
  gender: genderProp,
  onGender,
  home = false,
}: {
  right?: ReactNode;
  mobileRight?: ReactNode;
  gender?: Gender;
  onGender?: (g: Gender) => void;
  home?: boolean;
}) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [open, setOpen] = useState(false);
  const [storedGender, setStoredGender] = useState<Gender>("girls");
  const gender = genderProp ?? storedGender;
  const systemStatus = useSystemStatus();
  const navigate = useNavigate();

  useEffect(() => {
    setStoredGender(readGender());
  }, []);

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

  function pickGender(g: Gender) {
    storeGender(g);
    setStoredGender(g);
    setOpen(false);
    if (onGender) onGender(g);
    else navigate({ to: "/" });
  }

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

  const GenderIcon = gender === "guys" ? Mars : Venus;
  const pill =
    "tap-exempt inline-flex h-8 min-w-0 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3 text-xs font-semibold transition sm:h-9 sm:px-4 sm:text-sm";
  const navLink =
    "rounded-full px-3 py-2 text-sm font-medium text-white/75 transition hover:bg-white/5 hover:text-white";
  const item =
    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/85 transition hover:bg-white/5 hover:text-white";
  const close = () => setOpen(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/[0.06] bg-[#141414]/95 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-1.5 px-3 sm:gap-2 sm:px-6 md:h-16">
        <div className={`flex min-w-0 shrink-0 items-center ${home ? "lg:hidden" : ""}`}>
          <LogoLink className="h-7 md:h-8" />
        </div>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              className={`tap-exempt flex h-8 min-w-0 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-white/85 transition hover:bg-white/5 sm:h-9 sm:px-2 ${home ? "lg:hidden" : ""}`}
            >
              <GenderIcon className="h-4 w-4 text-primary" />
              <ChevronDown className="h-3.5 w-3.5 text-white/60" />
              <span className="sr-only">Open menu</span>
            </button>
          </SheetTrigger>
          {/* p-0 and a flex column, so the links below can scroll. The menu is
              taller than a 640px screen; the header stays put and only the
              list moves. */}
          <SheetContent
            side="left"
            className="flex w-[85vw] max-w-xs flex-col gap-0 overflow-hidden border-white/10 bg-[#1a1a1a] p-0"
          >
            <SheetHeader className="shrink-0 border-b border-white/10 px-5 pb-4 pt-5 text-left">
              <SheetTitle className="text-white">
                <LogoLink className="h-8" onClick={close} />
              </SheetTitle>
              {/* What used to be the Girls / Guys row under the bar. */}
              <div className="mt-3 grid grid-cols-2 gap-1 rounded-full bg-white/5 p-1">
                {(
                  [
                    { id: "girls", label: "Girls", Icon: Venus },
                    { id: "guys", label: "Guys", Icon: Mars },
                  ] as const
                ).map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => pickGender(id)}
                    className={`tap-exempt flex items-center justify-center gap-1.5 rounded-full py-2 text-sm font-semibold transition ${
                      gender === id
                        ? "bg-primary text-primary-foreground"
                        : "text-white/70 hover:text-white"
                    }`}
                  >
                    <Icon className="h-4 w-4" /> {label}
                  </button>
                ))}
              </div>
            </SheetHeader>

            {/* overscroll-contain stops a flick at the end of the list from
                scrolling the page underneath; the safe-area padding clears
                the phone's home indicator. */}
            <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
              <Link to="/" onClick={close} className={item}>
                <Home className="h-4 w-4 text-white/60" /> Home
              </Link>
              <Link to="/cams" onClick={close} className={item}>
                <Circle className="h-2 w-2 fill-red-500 text-red-500" /> Live Cams
              </Link>
              <Link to="/gallery" onClick={close} className={item}>
                <ImageIcon className="h-4 w-4 text-white/60" /> Gallery
              </Link>
              <Link to="/browse" onClick={close} className={item}>
                <Compass className="h-4 w-4 text-white/60" /> Browse Companions
              </Link>
              <Link to="/models" onClick={close} className={item}>
                <Users className="h-4 w-4 text-white/60" /> All AI Companions
              </Link>
              <Link to="/create" onClick={close} className={item}>
                <Sparkles className="h-4 w-4 text-primary" /> Create Companion
              </Link>
              {authed && (
                <Link to="/me" onClick={close} className={item}>
                  <MessageSquare className="h-4 w-4 text-white/60" /> My Chats
                </Link>
              )}
              <Link to="/credits" onClick={close} className={item}>
                <Gem className="h-4 w-4 text-amber-400" /> Buy Credits / Premium
              </Link>
              {authed && (
                <Link to="/history" onClick={close} className={item}>
                  <History className="h-4 w-4 text-white/60" /> Chat History
                </Link>
              )}
              <Link to="/affiliate" onClick={close} className={item}>
                <DollarSign className="h-4 w-4 text-emerald-400" /> Earn / Affiliate
              </Link>
              <Link to="/faq" onClick={close} className={item}>
                <HelpCircle className="h-4 w-4 text-white/60" /> Help Center
              </Link>
              <button
                type="button"
                onClick={() => {
                  close();
                  // The widget is mounted on every page but a conversation;
                  // there it is not, so the home page's copy answers instead.
                  if (window.location.pathname.startsWith("/chat/")) {
                    window.location.href = "/?support=1";
                    return;
                  }
                  openSupport();
                }}
                className={`tap-exempt min-h-0 text-left ${item}`}
              >
                <LifeBuoy className="h-4 w-4 text-white/60" /> Help &amp; support
              </button>
              <a href={supportMailto()} onClick={close} className={item}>
                <Mail className="h-4 w-4 text-white/60" />
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
                    close();
                    handleEnableNotifications();
                  }}
                  className={`tap-exempt min-h-0 text-left ${item}`}
                >
                  <Bell className="h-4 w-4 text-white/60" /> Enable Push Notifications
                </button>
              )}

              {isAdmin && (
                <Link to="/admin" onClick={close} className={`${item} text-amber-400`}>
                  <Shield className="h-4 w-4" /> Admin Console
                </Link>
              )}

              <div className="mt-3 border-t border-white/10 pt-3">
                <LanguageSelect />
              </div>
              {systemStatus && (
                <p className="px-3 pt-2 text-[10px] leading-snug text-white/40">
                  <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" />
                  {systemStatus}
                </p>
              )}

              <div className="mt-4 border-t border-white/10 px-1 pt-4">
                {authed ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      close();
                      handleSignOut();
                    }}
                    className="w-full justify-start gap-2 rounded-xl border-white/10"
                  >
                    <LogOut className="h-4 w-4" /> Sign Out
                  </Button>
                ) : (
                  <Button
                    asChild
                    className="w-full justify-start gap-2 rounded-xl bg-primary text-primary-foreground"
                    onClick={close}
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

        {/* Home on a large screen: the sidebar has the links, so the bar holds
            the Girls / Guys tabs instead. */}
        {home && (
          <div className="hidden items-center gap-1 rounded-full bg-white/5 p-1 lg:flex">
            {(
              [
                { id: "girls", label: "Girls", Icon: Venus },
                { id: "guys", label: "Guys", Icon: Mars },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => pickGender(id)}
                className={`tap-exempt flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                  gender === id ? "bg-primary text-primary-foreground" : "text-white/65 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
        )}

        {/* Desktop links */}
        {!home && (
          <nav className="ml-2 hidden items-center gap-0.5 md:flex">
            <Link to="/cams" className={`${navLink} inline-flex items-center`}>
              <Circle className="mr-1.5 h-2 w-2 fill-red-500 text-red-500" /> Live
            </Link>
            <Link to="/browse" className={navLink}>
              Browse
            </Link>
            <Link to="/gallery" className={navLink}>
              Gallery
            </Link>
            <Link to="/create" className={navLink}>
              Create
            </Link>
            {authed && (
              <Link to="/me" className={navLink}>
                My chats
              </Link>
            )}
          </nav>
        )}

        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2">
          <span className="sm:hidden">
            <LanguageSelect flagOnly />
          </span>
          <span className="hidden sm:inline-flex">
            <LanguageSelect compact />
          </span>
          {authed === false && (
            <>
              <Link
                to="/auth"
                search={{ mode: "signin" } as any}
                className={`${pill} border border-white/25 text-white hover:bg-white/5`}
              >
                Login
              </Link>
              <Link to="/auth" className={`${pill} bg-primary text-primary-foreground hover:bg-primary/90`}>
                Join Free
              </Link>
            </>
          )}
          {authed && (
            <>
              {mobileRight && <span className="md:hidden">{mobileRight}</span>}
              {!mobileRight && (
                <Link
                  to="/me"
                  className={`${pill} border border-white/25 text-white hover:bg-white/5 ${home ? "" : "md:hidden"}`}
                >
                  My chats
                </Link>
              )}
              {home && (
                <Link to="/browse" className={`${pill} bg-primary text-primary-foreground hover:bg-primary/90`}>
                  Explore
                </Link>
              )}
            </>
          )}
          {right && <div className="hidden items-center gap-2 md:flex">{right}</div>}
        </div>
      </div>
    </header>
  );
}
