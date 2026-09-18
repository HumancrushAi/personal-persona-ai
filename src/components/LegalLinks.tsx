import { Link } from "@tanstack/react-router";
import { LEGAL_DOCS } from "@/lib/legal-docs";

// The policy links, for a footer or a menu. Every page that mentions "the
// Terms" links here, so the phrase is never a promise about a page that does
// not exist.
export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/40 ${className}`}>
      {LEGAL_DOCS.map((d) => (
        <Link
          key={d.slug}
          to="/legal/$slug"
          params={{ slug: d.slug }}
          className="hover:text-white hover:underline"
        >
          {d.title}
        </Link>
      ))}
    </div>
  );
}
