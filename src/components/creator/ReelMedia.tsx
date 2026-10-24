import { useEffect, useRef, useState } from "react";
import { resizedImage } from "@/lib/companion-images";

function motionAllowed() {
  if (typeof window === "undefined") return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !connection?.saveData && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A model's looping reel over her portrait. The portrait shows at once; the
 * clip is only fetched while the card is on screen (and, when `active` is
 * given, only while it is true), then fades in once it is actually playing.
 * Reduced motion, data saver, or a missing reel all leave the portrait.
 */
export function ReelMedia({ reel, poster, alt, active, eager = false, className = "", posterWidth = 420 }: {
  reel: string | null;
  poster: string;
  alt: string;
  /** Omit to play whenever visible; pass a boolean to play only when true. */
  active?: boolean;
  eager?: boolean;
  className?: string;
  /** Poster is fetched resized to this width (CSS px at ~2x density). */
  posterWidth?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => setAllowed(motionAllowed()), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !reel || !allowed) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), { threshold: 0.4 });
    observer.observe(host);
    return () => observer.disconnect();
  }, [reel, allowed]);

  const shouldPlay = !!reel && allowed && !failed && visible && active !== false;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (shouldPlay) void video.play().catch(() => undefined);
    else video.pause();
  }, [shouldPlay]);

  return (
    <div ref={hostRef} className={`relative overflow-hidden bg-[#232327] ${className}`}>
      {poster && <img src={resizedImage(poster, posterWidth)} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" className="absolute inset-0 h-full w-full object-cover object-top" />}
      {reel && allowed && !failed && (visible || playing) && (
        <video
          ref={videoRef}
          src={reel}
          muted
          loop
          playsInline
          autoPlay={shouldPlay}
          preload="metadata"
          aria-hidden="true"
          onPlaying={() => setPlaying(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-500 ${playing && shouldPlay ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </div>
  );
}
