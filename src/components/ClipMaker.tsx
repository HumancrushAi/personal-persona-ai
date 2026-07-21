import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { companionImage } from "@/lib/companion-images";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

// Makes a short 9:16 promo video (model photo + a caption + branding) entirely
// in the browser via canvas + MediaRecorder — for posting to social media.
const W = 720;
const H = 1280;
const DURATION = 6000;

const PRESET_JOKES = [
  "I don't have a gag reflex… or a filter. 😈 HumanCrush.com",
  "They said talk dirty to me, so I sent a 3-paragraph essay. 🔥",
  "I'm free tonight. And every night. I'm an AI. 💋",
  "Your ex won't text back? I never stop texting. 😏",
  "Come find out what I'm NOT wearing. 18+ only 🔞",
];

type Model = { id: string; name: string; image_url: string };

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
        .select("id, name, image_url")
        .is("created_by", null)
        .order("sort_order");
      if (error) throw error;
      return data as Model[];
    },
  });

  const [modelId, setModelId] = useState<string>("");
  const [caption, setCaption] = useState(PRESET_JOKES[0]);
  const [busy, setBusy] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!modelId && models?.length) setModelId(models[0].id);
  }, [models, modelId]);

  const model = models?.find((m) => m.id === modelId);

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

    const draw = (t: number) => {
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

      // LIVE badge
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.beginPath();
      ctx.roundRect(28, 28, 150, 52, 26);
      ctx.fill();
      ctx.fillStyle = "#ff3b3b";
      ctx.beginPath();
      ctx.arc(58, 54, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 28px Inter, sans-serif";
      ctx.fillText("LIVE", 78, 64);

      // caption (fade/slide in)
      const ci = Math.min(1, t / 0.25);
      ctx.globalAlpha = ci;
      ctx.font = "bold 52px Inter, sans-serif";
      ctx.textAlign = "center";
      const lines = wrapText(ctx, caption, W - 100);
      const lh = 64;
      let y = H - 200 - (lines.length - 1) * lh + (1 - ci) * 30;
      ctx.fillStyle = "#fff";
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 12;
      for (const ln of lines) {
        ctx.fillText(ln, W / 2, y);
        y += lh;
      }
      ctx.shadowBlur = 0;

      // brand watermark
      ctx.globalAlpha = 1;
      ctx.font = "bold 40px 'Fraunces', serif";
      ctx.fillStyle = "#ff4d8d";
      ctx.fillText("❤ HumanCrush.com", W / 2, H - 70);
      ctx.textAlign = "left";
    };

    try {
      const stream = canvas.captureStream(30);
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        setVideoUrl(URL.createObjectURL(blob));
        setBusy(false);
      };
      rec.start();
      const start = performance.now();
      const frame = (now: number) => {
        const t = Math.min(1, (now - start) / DURATION);
        draw(t);
        if (t < 1) requestAnimationFrame(frame);
        else setTimeout(() => rec.stop(), 120);
      };
      requestAnimationFrame(frame);
    } catch (e: any) {
      setBusy(false);
      toast.error(e?.message ?? "Recording not supported in this browser");
    }
  }

  return (
    <section className="glass max-w-3xl rounded-2xl p-4">
      <h2 className="mb-1 font-display text-lg">Make a social clip</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Pick a model + a caption → download a 9:16 video for TikTok/Reels. Regenerate a model's
        photo first if it looks off.
      </p>

      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Model</Label>
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="h-9 w-full rounded-md border border-white/10 bg-transparent px-2 text-sm"
            >
              {models?.map((m) => (
                <option key={m.id} value={m.id} className="bg-background">
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Caption / dirty joke</Label>
            <textarea
              rows={3}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={140}
              className="w-full rounded-md border border-white/10 bg-white/5 p-2 text-sm"
            />
            <div className="mt-1 flex flex-wrap gap-1">
              {PRESET_JOKES.map((j, i) => (
                <button
                  key={i}
                  onClick={() => setCaption(j)}
                  className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-muted-foreground hover:text-primary"
                >
                  Joke {i + 1}
                </button>
              ))}
            </div>
          </div>
          <Button onClick={makeClip} disabled={busy || !model}>
            {busy ? "Rendering…" : "Generate clip"}
          </Button>
          {videoUrl && (
            <a
              href={videoUrl}
              download={`humancrush-${model?.name ?? "clip"}.webm`}
              className="ml-2 inline-flex items-center rounded-full bg-grad-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              ⬇ Download
            </a>
          )}
        </div>

        <div className="w-40 shrink-0">
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            className="w-full rounded-xl border border-white/10 bg-black"
          />
          {videoUrl && <video src={videoUrl} controls loop className="mt-2 w-full rounded-xl" />}
        </div>
      </div>
    </section>
  );
}
