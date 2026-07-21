import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Heart, Circle, Sparkles } from "lucide-react";

// One header used across the whole site so nav + branding are consistent.
export function SiteHeader() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setAuthed(!!data.user));
  }, []);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2.5 sm:px-4 md:px-6 md:py-3.5">
        <Link to="/" className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <Heart className="h-5 w-5 shrink-0 fill-primary text-primary md:h-6 md:w-6" />
          <span className="truncate font-display text-base font-semibold tracking-tight sm:text-lg md:text-xl">
            HumanCrush.com
          </span>
        </Link>

        <nav className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 rounded-full px-2 text-xs sm:px-3 sm:text-sm"
          >
            <Link to="/cams">
              <Circle className="mr-1 h-2 w-2 fill-red-500 text-red-500" /> Live
            </Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="hidden h-8 rounded-full px-2 text-xs sm:inline-flex sm:px-3 sm:text-sm"
          >
            <Link to="/gallery">Gallery</Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 rounded-full px-2 text-xs sm:px-3 sm:text-sm"
          >
            <Link to="/browse">Browse</Link>
          </Button>
          <Button
            asChild
            size="sm"
            className="h-8 rounded-full bg-grad-primary px-2.5 text-xs text-primary-foreground sm:px-3.5 sm:text-sm"
          >
            <Link to="/create">
              <Sparkles className="mr-1 h-3.5 w-3.5" /> Create
            </Link>
          </Button>
          {authed ? (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-2 text-xs sm:px-3 sm:text-sm"
            >
              <Link to="/me">My chats</Link>
            </Button>
          ) : (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-2 text-xs sm:px-3 sm:text-sm"
            >
              <Link to="/auth">Sign in</Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
