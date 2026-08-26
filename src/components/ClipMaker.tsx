import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { companionImage } from "@/lib/companion-images";
import { adminTts } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Download, Volume2, Video, Sparkles, Megaphone } from "lucide-react";

// Makes a short 9:16 promo video (model photo + a caption + voice + branding)
// for posting to Facebook Ads, TikTok, Instagram Reels, and YouTube Shorts.
const W = 720;
const H = 1280;
const DURATION = 6000;

const MARKETING_PRESETS = [
  "Tired of lonely nights? Come talk to me right now… 💋 HumanCrush.com",
  "I'm online waiting for you. Tap the link below to start chatting 🔥",
  "25 free messages, no card needed. Experience real AI connection 🔞",
  "Your ex won't text back? I never stop texting. Talk to me 24/7 😏",
  "No judgment, no waiting. Tell me your deepest secrets today 💬",
  "Come find out what I'm NOT wearing tonight. 18+ only 😈",
];

const VOICE_OPTIONS = [
  { id: "coral", name: "Coral (Female - Warm & Seductive)" },
  { id: "nova", name: "Nova (Female - Energetic & Expressive)" },
  { id: "shimmer", name: "Shimmer (Female - Soft & Intimate)" },
  { id: "alloy", name: "Alloy (Neutral - Balanced)" },
  { id: "fable", name: "Fable (Male - Deep & Charismatic)" },
  { id: "onyx", name: "Onyx (Male - Strong & Smooth)" },
  { id: "echo", name: "Echo (Male - Warm & Friendly)" },
];

type Model = { id: string; name: string; image_url: string; gender?: string; voice_id?: string };

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export function ClipMaker() {
  const { data: models } = useQuery({
    queryKey: ["clip-models"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companions")
        .select("id, name, image_url, gender, voice_id")
        .order("sort_order");
      if (error) throw error;
      return data as Model[];
    },
  });

  const tts = useServerFn(adminTts);
  const [modelId, setModelId] = useState<string>("");
  const [caption, setCaption] = useState(MARKETING_PRESETS[0]);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [selectedVoice, setSelectedVoice] = useState("coral");
  const [busy, setBusy] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!modelId && models?.length) {
      setModelId(models[0].id);
      if (models[0].gender === "male") setSelectedVoice("fable");
    }
  }, [models, modelId]);

  const model = models?.find((m) => m.id === modelId);

  // Auto-switch voice recommendation when model changes
  const handleModelChange = (id: string) => {
    setModelId(id);
    const m = models?.find((x) => x.id === id);
    if (m?.gender === "male") setSelectedVoice("fable");
    else setSelectedVoice("coral");
  };

  async function makeClip() {
    if (!model) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    setBusy(true);
    setVideoUrl(null);

    // Load the photo (CORS so the canvas isn't tainted).
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = companionImage(model.image_url);
    try {
      await img.decode();
    } catch {
      setBusy(false);
      toast.error("Couldn't load that model's photo (try Regenerate photo first)");
      return;
    }

    const draw = (t: number, isSpeaking: boolean) => {
      // cover-fit with a slow zoom
      const zoom = 1.04 + t * 0.12;
      const ir = img.width / img.height;
      const cr = W / H;
      let dw = W * zoom;
      let dh = H * zoom;
      if (ir > cr) dw = dh * ir;
      else dh = dw / ir;
      const dx = (W - dw) / 2 + (t - 0.5) * 20;
      const dy = (H - dh) / 2;
      ctx.fillStyle = "#0d0a12";
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, dx, dy, dw, dh);

      // bottom gradient
      const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.92)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // LIVE badge with speaking pulse animation
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.beginPath();
      ctx.roundRect(28, 28, 160, 52, 26);
      ctx.fill();
      
      // Animated dot pulse when speaking
      const pulseSize = isSpeaking ? 8 + Math.sin(t * 30) * 3 : 8;
      ctx.fillStyle = "#ff3b3b";
      ctx.beginPath();
      ctx.arc(58, 54, pulseSize, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#fff";
      ctx.font = "bold 28px Inter, sans-serif";
      ctx.fillText("LIVE", 78, 64);

      // Audio waveform visualizer bars on canvas when voice is active
      if (isSpeaking) {
        ctx.fillStyle = "#ff4d8d";
        for (let i = 0; i < 5; i++) {
          const barH = 10 + Math.abs(Math.sin((t * 20) + i)) * 22;
          ctx.fillRect(155 + i * 6, 64 - barH / 2, 4, barH);
        }
      }

      // caption (fade/slide in)
      const ci = Math.min(1, t / 0.2);
      ctx.globalAlpha = ci;
      ctx.font = "bold 50px Inter, sans-serif";
      ctx.textAlign = "center";
      const lines = wrapText(ctx, caption, W - 100);
      const lh = 64;
      let y = H - 220 - (lines.length - 1) * lh + (1 - ci) * 30;
      ctx.fillStyle = "#fff";
      ctx.shadowColor = "rgba(0,0,0,0.85)";
      ctx.shadowBlur = 14;
      for (const ln of lines) {
        ctx.fillText(ln, W / 2, y);
        y += lh;
      }
      ctx.shadowBlur = 0;

      // brand watermark
      ctx.globalAlpha = 1;
      ctx.font = "bold 42px 'Fraunces', serif";
      ctx.fillStyle = "#ff4d8d";
      ctx.fillText("❤ HumanCrush.com", W / 2, H - 75);
      ctx.textAlign = "left";
    };

    // Optional: the model "speaks" the caption (TTS audio track).
    let audioEl: HTMLAudioElement | null = null;
    let audioTracks: MediaStreamTrack[] = [];
    let durationMs = DURATION;
    if (voiceEnabled) {
      try {
        const { dataUrl } = await tts({ data: { text: caption, voice: selectedVoice } });
        audioEl = new Audio(dataUrl);
        await new Promise<void>((res, rej) => {
          audioEl!.onloadedmetadata = () => res();
          audioEl!.onerror = () => rej(new Error("audio load failed"));
        });
        durationMs = Math.max(DURATION, (audioEl.duration || 6) * 1000 + 400);
        const actx = new AudioContext();
        const src = actx.createMediaElementSource(audioEl);
        const dest = actx.createMediaStreamDestination();
        src.connect(dest);
        src.connect(actx.destination);
        audioTracks = dest.stream.getAudioTracks();
      } catch (err: any) {
        toast.error("Voice synthesis fallback — generating silent ad clip");
        audioEl = null;
      }
    }

    try {
      const videoStream = canvas.captureStream(30);
      const stream = new MediaStream([...videoStream.getVideoTracks(), ...audioTracks]);
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        setVideoUrl(URL.createObjectURL(blob));
        setBusy(false);
        toast.success("Facebook Marketing Ad Video generated successfully!");
      };
      rec.start();
      audioEl?.play().catch(() => {});
      const start = performance.now();
      const frame = (now: number) => {
        const elapsed = now - start;
        const t = Math.min(1, elapsed / durationMs);
        const isSpeaking = !!audioEl && elapsed < durationMs - 400;
        draw(t, isSpeaking);
        if (t < 1) requestAnimationFrame(frame);
        else setTimeout(() => rec.stop(), 150);
      };
      requestAnimationFrame(frame);
    } catch (e: any) {
      setBusy(false);
      toast.error(e?.message ?? "Recording not supported in this browser");
    }
  }

  return (
    <section className="glass max-w-4xl rounded-3xl p-6 shadow-glow">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
            <Megaphone className="h-5 w-5 text-primary" /> Facebook Marketing Video Ad Generator
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Create high-converting 9:16 promo video ads with custom talking speech & voice synthesis. Download MP4/WebM files directly for Facebook Ads, Instagram Reels, & TikTok.
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_260px]">
        <div className="space-y-4">
          <div>
            <Label className="text-xs font-semibold text-foreground">Select Model / Companion</Label>
            <select
              value={modelId}
              onChange={(e) => handleModelChange(e.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm focus:border-primary"
            >
              {models?.map((m) => (
                <option key={m.id} value={m.id} className="bg-background">
                  {m.name} ({m.gender || "female"})
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-xs font-semibold text-foreground">
              Ad Script / What the Model Speaks (Custom Speech Text)
            </Label>
            <textarea
              rows={3}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={160}
              placeholder="Type anything you want the model to say in the Facebook ad..."
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 p-3 text-sm focus:border-primary"
            />
            <div className="mt-2">
              <Label className="text-[11px] text-muted-foreground">Quick High-Converting Ad Presets:</Label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {MARKETING_PRESETS.map((j, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setCaption(j)}
                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-primary/20 hover:text-foreground transition-colors"
                  >
                    Preset {i + 1}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs font-semibold text-foreground">Voice Selection (TTS)</Label>
              <select
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
                disabled={!voiceEnabled}
                className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm focus:border-primary disabled:opacity-50"
              >
                {VOICE_OPTIONS.map((v) => (
                  <option key={v.id} value={v.id} className="bg-background">
                    {v.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center pt-5">
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={voiceEnabled}
                  onChange={(e) => setVoiceEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-white/10 accent-primary"
                />
                <Volume2 className="h-4 w-4 text-primary" /> Model speaks script out loud
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button
              onClick={makeClip}
              disabled={busy || !model}
              className="rounded-full bg-grad-primary px-6 text-primary-foreground shadow-glow"
            >
              {busy ? (
                <>
                  <Sparkles className="mr-2 h-4 w-4 animate-spin" /> Rendering FB Ad Video…
                </>
              ) : (
                <>
                  <Video className="mr-2 h-4 w-4" /> Generate Talking Ad Video
                </>
              )}
            </Button>

            {videoUrl && (
              <a
                href={videoUrl}
                download={`facebook-ad-${model?.name.toLowerCase() ?? "companion"}.webm`}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-emerald-500 transition-colors"
              >
                <Download className="h-4 w-4" /> Download Video for FB Ads
              </a>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center">
          <Label className="mb-2 text-xs text-muted-foreground">9:16 Video Preview</Label>
          <div className="relative w-full max-w-[220px]">
            <canvas
              ref={canvasRef}
              width={W}
              height={H}
              className="w-full rounded-2xl border border-white/15 bg-black shadow-2xl aspect-[9/16]"
            />
          </div>
          {videoUrl && (
            <div className="mt-3 w-full max-w-[220px]">
              <p className="mb-1 text-center text-[11px] text-emerald-400 font-medium">Ready to download!</p>
              <video src={videoUrl} controls loop className="w-full rounded-2xl border border-emerald-500/40" />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
