import { Link } from "@tanstack/react-router";
import { Heart, Mail } from "lucide-react";
import { LEGAL_DOCS } from "@/lib/legal-docs";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support-contact";
import { useSystemStatus } from "@/hooks/use-app-setting";

// The site footer: the policies, support and the 18+ notice, on every page and
// every screen size.
//
// The policies used to be an entry in the phone menu only, which meant a
// desktop visitor had no way to reach them at all and a phone visitor had to
// open a menu to find the Terms they had already agreed to. A footer is where
// people look for them, and it is the same footer at every width — the columns
// simply wrap.
//
// pb-28 on small screens clears the fixed bottom tab bar (BottomNav), which
// would otherwise sit on top of the last row of links.
export function SiteFooter({ className = "" }: { className?: string }) {
  const systemStatus = useSystemStatus();
  const year = 2026;

  return (
    <footer className={`mt-16 border-t border-white/10 bg-[#0b0810] ${className}`}>
      <div className="mx-auto max-w-7xl px-5 pb-28 pt-10 md:px-8 md:pb-10">
        <div className="flex flex-col gap-8 md:flex-row md:justify-between">
          <div className="max-w-xs">
            <Link to="/" className="flex items-center gap-2">
              <Heart className="h-5 w-5 fill-primary text-primary" />
              <span className="font-display text-lg font-bold tracking-tight">
                HumanCrush<span className="text-primary">.com</span>
              </span>
            </Link>
            <p className="mt-3 text-xs leading-relaxed text-white/45">
              Adults only, 18+. Every companion is a fictional, AI-generated character. No companion
              is, depicts or is based on a real person.
            </p>
          </div>

          <nav className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/70">
                Explore
              </p>
              <ul className="space-y-1.5 text-xs text-white/50">
                <li>
                  <Link to="/browse" className="transition hover:text-white">
                    Browse companions
                  </Link>
                </li>
                <li>
                  <Link to="/create" className="transition hover:text-white">
                    Create a companion
                  </Link>
                </li>
                <li>
                  <Link to="/cams" className="transition hover:text-white">
                    Live
                  </Link>
                </li>
                <li>
                  <Link to="/credits" className="transition hover:text-white">
                    Credits &amp; Premium
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/70">
                Help
              </p>
              <ul className="space-y-1.5 text-xs text-white/50">
                <li>
                  <Link to="/faq" className="transition hover:text-white">
                    Help Center
                  </Link>
                </li>
                <li>
                  <Link to="/affiliate" className="transition hover:text-white">
                    Earn / Affiliate
                  </Link>
                </li>
                <li>
                  <a
                    href={supportMailto()}
                    className="inline-flex items-center gap-1.5 transition hover:text-white"
                  >
                    <Mail className="h-3 w-3 shrink-0" /> {SUPPORT_EMAIL}
                  </a>
                </li>
              </ul>
            </div>

            {/* Every policy, by name. A "Legal" link that hides nine documents
                behind one more tap is what sent people to the menu instead. */}
            <div className="col-span-2 sm:col-span-1">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/70">
                Legal
              </p>
              <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-white/50 sm:grid-cols-1">
                {LEGAL_DOCS.map((d) => (
                  <li key={d.slug}>
                    <Link
                      to="/legal/$slug"
                      params={{ slug: d.slug }}
                      className="transition hover:text-white"
                    >
                      {d.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-white/10 pt-5 text-[11px] text-white/35 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} Next Level Rec. · HumanCrush.com — 18+ only. All characters are fictional and
            AI-generated.
          </p>
          {systemStatus && (
            <p className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {systemStatus}
            </p>
          )}
        </div>
      </div>
    </footer>
  );
}
