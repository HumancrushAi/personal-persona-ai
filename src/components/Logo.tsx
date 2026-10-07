import { Link } from "@tanstack/react-router";

export function Logo({ className = "h-6 md:h-8 text-foreground" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className} shrink min-w-0`}>
      <img
        src="/logo.png"
        alt="HumanCrush Logo"
        className="h-full w-auto rounded-lg shadow-[0_0_15px_rgba(236,72,153,0.3)] shrink-0 object-cover"
      />
      <span className="font-display text-lg sm:text-xl md:text-2xl font-bold tracking-tight text-white/90 truncate drop-shadow-sm hidden min-[340px]:inline-block">
        HumanCrush
      </span>
    </div>
  );
}

export function LogoLink({ className = "h-6 md:h-8", onClick }: { className?: string, onClick?: () => void }) {
  return (
    <Link to="/" onClick={onClick} className="flex shrink items-center gap-1.5 min-w-0 sm:gap-2 group">
      <div className="transition-transform group-hover:scale-105 duration-300 h-full">
        <Logo className={className} />
      </div>
    </Link>
  );
}
