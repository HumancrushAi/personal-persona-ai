import { Link } from "@tanstack/react-router";

export function Logo({ className = "h-6 md:h-8 text-foreground" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 sm:gap-2.5 ${className} shrink-0 min-w-0`}>
      <img
        src="/logo.png"
        alt="HumanCrush Logo"
        className="h-full w-auto rounded-lg shrink-0 object-cover"
      />
      {/* Phones are mostly under 420px wide, where the full name used to be
          hidden and the logo read as a tiny icon on its own. They get "HC"
          instead; wider screens get the full name. */}
      <span className="font-display text-lg font-extrabold tracking-tight text-white/95 drop-shadow-sm min-[420px]:hidden">
        HC
      </span>
      <span className="font-display text-base sm:text-xl md:text-2xl font-extrabold tracking-tight text-white/95 truncate drop-shadow-sm hidden min-[420px]:inline-block">
        HumanCrush
      </span>
    </div>
  );
}

export function LogoLink({ className = "h-6 md:h-8", onClick }: { className?: string, onClick?: () => void }) {
  return (
    <Link to="/" onClick={onClick} className="flex shrink-0 items-center gap-1.5 min-w-0 group">
      <div className="transition-transform group-hover:scale-105 duration-300 h-full flex items-center">
        <Logo className={className} />
      </div>
    </Link>
  );
}

