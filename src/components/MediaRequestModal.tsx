import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { X, Image as ImageIcon, Video as VideoIcon } from "lucide-react";

// Asks what the user actually wants before spending their credits.
//
// This replaced a window.prompt: a browser dialog in the middle of a chat looks
// like a bug, can't show what it costs, and on mobile covers the conversation.
// Whatever is typed here is what gets sent to the generation endpoint as the
// prompt, so an empty box is the one case worth guarding against — that is how
// you end up paying for "whatever it felt like making".

export type MediaKind = "photo" | "video";

// Clip length is frames / fps on the endpoint. 16fps is its tuned default, so
// seconds are expressed in frames here and converted at the call site.
const LENGTHS = [
  { label: "5s", seconds: 5 },
  { label: "8s", seconds: 8 },
  { label: "10s", seconds: 10 },
];

const IDEAS: Record<MediaKind, string[]> = {
  photo: [
    "in the shower, wet hair",
    "lying on the bed, looking at me",
    "in black lingerie by the window",
    "bent over the kitchen counter",
  ],
  video: [
    "slowly taking her dress off",
    "dancing for me in lingerie",
    "touching herself on the bed",
    "walking towards the camera",
  ],
};

export function MediaRequestModal({
  kind,
  name,
  cost,
  onClose,
  onSubmit,
}: {
  kind: MediaKind;
  name: string;
  cost: number;
  onClose: () => void;
  onSubmit: (prompt: string, seconds: number) => void;
}) {
  const [text, setText] = useState("");
  const [seconds, setSeconds] = useState(5);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const ready = text.trim().length > 0;
  const submit = () => ready && onSubmit(text.trim(), seconds);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/80 backdrop-blur-sm md:items-center md:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-t-3xl border border-white/10 bg-card shadow-glow md:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-white/10 p-4">
          {kind === "photo" ? (
            <ImageIcon className="h-5 w-5 text-primary" />
          ) : (
            <VideoIcon className="h-5 w-5 text-primary" />
          )}
          <p className="flex-1 font-display text-base font-semibold">
            What would you like to see {name} {kind === "photo" ? "in a photo" : "do on video"}?
          </p>
          <button
            onClick={onClose}
            className="rounded-full p-2 hover:bg-white/10"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={3}
            maxLength={500}
            placeholder={`Describe it — e.g. "${IDEAS[kind][0]}"`}
            className="w-full resize-y rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm outline-none placeholder:text-white/35 focus:border-primary/50"
          />

          <div className="flex flex-wrap gap-1.5">
            {IDEAS[kind].map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => setText(idea)}
                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/75 hover:bg-white/10"
              >
                {idea}
              </button>
            ))}
          </div>

          {kind === "video" && (
            <div>
              <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                Length
              </p>
              <div className="flex gap-2">
                {LENGTHS.map((l) => (
                  <button
                    key={l.seconds}
                    type="button"
                    onClick={() => setSeconds(l.seconds)}
                    className={`flex-1 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      seconds === l.seconds
                        ? "border-primary/60 bg-grad-primary text-primary-foreground"
                        : "border-white/10 bg-white/5 text-white/75 hover:bg-white/10"
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                Longer clips take proportionally longer to render.
              </p>
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-white/10 p-4">
          <Button
            onClick={submit}
            disabled={!ready}
            className="w-full rounded-full bg-grad-primary text-primary-foreground shadow-glow"
          >
            Generate · {cost} credits
          </Button>
          <p className="text-center text-[10px] text-muted-foreground">
            {kind === "photo" ? "Takes about a minute and a half." : "Takes a couple of minutes."}
          </p>
        </div>
      </div>
    </div>
  );
}
