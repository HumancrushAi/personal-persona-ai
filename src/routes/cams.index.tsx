import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { viewerCount, getCompanionReel, companionReelUrl } from "@/lib/reels";
import { companionImage } from "@/lib/companion-images";
import { SiteHeader } from "@/components/SiteHeader";
import { Circle } from "lucide-react";
import { useState, useRef, useEffect, useMemo } from "react";

export const Route = createFileRoute("/cams/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Live Cams — HumanCrush.com" },
      {
        name: "description",
        content: "Watch your favorite AI companions live. Tip, chat, go private.",
      },
    ],
  }),
  component: CamsPage,
});

function CamsPage() {
  const { data: models } = useQuery({
    queryKey: ["cams-models"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companions")
        .select("id, name, age, ethnicity, image_url, gender")
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const sortedModels = useMemo(() => {
    if (!models) return [];
    return [...models].sort((a, b) => {
      const hasA = getCompanionReel(a.name) ? 1 : 0;
      const hasB = getCompanionReel(b.name) ? 1 : 0;
      return hasB - hasA;
    });
  }, [models]);

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <section className="mx-auto max-w-6xl px-6 py-8 pb-20">
        <div className="flex items-center gap-2">
          <Circle className="h-3 w-3 fill-red-500 text-red-500" />
          <h1 className="font-display text-4xl font-semibold md:text-5xl">Live now</h1>
        </div>
        <p className="mt-2 text-muted-foreground">
          Tap anyone to watch them live — send a tip or go private.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {sortedModels.map((c) => (
            <CamCard key={c.id} c={c} />
          ))}
        </div>
      </section>
    </div>
  );
}

function CamCard({ c }: { c: any }) {
  const [hovered, setHovered] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Her own generated clip; the name-pinned stock reel is only a fallback for
  // companions whose clip doesn't exist yet, and a 404 falls back to the photo.
  const [reelFailed, setReelFailed] = useState(false);
  const reel = reelFailed ? getCompanionReel(c.name) : companionReelUrl(c.id);

  useEffect(() => {
    if (hovered && reel) {
      videoRef.current?.play().catch(() => {});
    } else {
      videoRef.current?.pause();
      if (videoRef.current) videoRef.current.currentTime = 0;
    }
  }, [hovered, reel]);

  return (
    <Link
      to="/cams/$id"
      params={{ id: c.id }}
      onMouseEnter={() => reel && setHovered(true)}
      onMouseLeave={() => reel && setHovered(false)}
      className="group relative aspect-[3/4.2] overflow-hidden rounded-3xl border border-white/10 bg-card shadow-md transition hover:shadow-glow"
    >
      <img
        src={companionImage(c.image_url)}
        alt={c.name}
        loading="lazy"
        className={`absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-300 ${
          hovered && reel ? "opacity-0" : "opacity-100 animate-live"
        }`}
      />
      {reel && (
        <video
          ref={videoRef}
          src={reel}
          muted
          loop
          playsInline
          preload="none"
          onError={() => setReelFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            hovered ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold backdrop-blur">
          <Circle className="h-1.5 w-1.5 fill-red-500 text-red-500" /> LIVE
        </span>
        <span className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] backdrop-blur">
          👁 {viewerCount(c.id)}
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3">
        <div className="font-display text-lg font-semibold text-white">
          {c.name}, {c.age}
        </div>
        <div className="text-[11px] uppercase tracking-wide text-white/70">
          {c.ethnicity}
        </div>
      </div>
    </Link>
  );
}
