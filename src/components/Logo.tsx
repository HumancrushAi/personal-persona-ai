import { Link } from "@tanstack/react-router";

export function Logo({ className = "h-5 md:h-6 text-foreground" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className} shrink min-w-0`}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-auto shrink-0 drop-shadow-[0_0_8px_rgba(244,63,94,0.5)]"
      >
        <path 
          d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" 
          fill="url(#grad_logo)" 
        />
        <defs>
          <linearGradient id="grad_logo" x1="2" y1="3" x2="22" y2="21.35" gradientUnits="userSpaceOnUse">
            <stop stopColor="#f43f5e" /> {/* rose-500 */}
            <stop offset="1" stopColor="#d946ef" /> {/* fuchsia-500 */}
          </linearGradient>
        </defs>
      </svg>
      <span className="font-display text-lg sm:text-xl md:text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-rose-400 via-fuchsia-400 to-purple-400 truncate drop-shadow-sm hidden min-[340px]:inline-block">
        HumanCrush<span className="hidden sm:inline text-white/90 drop-shadow-none">.com</span>
      </span>
    </div>
  );
}

export function LogoLink({ className = "h-5 md:h-6", onClick }: { className?: string, onClick?: () => void }) {
  return (
    <Link to="/" onClick={onClick} className="flex shrink items-center gap-1.5 min-w-0 sm:gap-2 group">
      <div className="transition-transform group-hover:scale-105">
        <Logo className={className} />
      </div>
    </Link>
  );
}
