// Renders a short 9:16 "talking" video entirely in the browser: the model's
// photo with a slow zoom, her spoken line as a caption, brand watermark, and her
// voice (TTS) as the audio track. Returns a data:video/webm base64 URL so it can
// be stored as a chat message. Used by the chat "request a video" button.
const W = 540;
const H = 960;
const MIN_MS = 4000;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
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

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Could not encode video"));
    r.readAsDataURL(blob);
  });
}

export async function renderTalkingClip(opts: {
  imageUrl: string;
  caption: string;
  audioUrl: string;
}): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // Load the photo (CORS so the canvas isn't tainted).
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = opts.imageUrl;
  await img.decode().catch(() => {
    throw new Error("Couldn't load her photo for the video");
  });

  // Her voice as the audio track.
  let audioEl: HTMLAudioElement | null = null;
  let audioTracks: MediaStreamTrack[] = [];
  let durationMs = MIN_MS;
  let actx: AudioContext | null = null;
  try {
    audioEl = new Audio(opts.audioUrl);
    await new Promise<void>((res, rej) => {
      audioEl!.onloadedmetadata = () => res();
      audioEl!.onerror = () => rej(new Error("audio load failed"));
    });
    durationMs = Math.max(MIN_MS, (audioEl.duration || 4) * 1000 + 400);
    actx = new AudioContext();
    const src = actx.createMediaElementSource(audioEl);
    const dest = actx.createMediaStreamDestination();
    src.connect(dest);
    src.connect(actx.destination);
    audioTracks = dest.stream.getAudioTracks();
  } catch {
    audioEl = null; // silent fallback
  }

  const draw = (t: number) => {
    const zoom = 1.04 + t * 0.14;
    const ir = img.width / img.height;
    const cr = W / H;
    let dw = W * zoom;
    let dh = H * zoom;
    if (ir > cr) dw = dh * ir;
    else dh = dw / ir;
    const dx = (W - dw) / 2 + (t - 0.5) * 18;
    const dy = (H - dh) / 2;
    ctx.fillStyle = "#0d0a12";
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, dx, dy, dw, dh);

    const g = ctx.createLinearGradient(0, H * 0.5, 0, H);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.9)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const ci = Math.min(1, t / 0.2);
    ctx.globalAlpha = ci;
    ctx.textAlign = "center";
    ctx.font = "600 34px Inter, system-ui, sans-serif";
    const lines = wrap(ctx, opts.caption, W - 80);
    const lh = 44;
    let y = H - 150 - (lines.length - 1) * lh;
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 10;
    for (const ln of lines) {
      ctx.fillText(ln, W / 2, y);
      y += lh;
    }
    ctx.shadowBlur = 0;

    ctx.globalAlpha = 1;
    ctx.font = "700 26px 'Fraunces', Georgia, serif";
    ctx.fillStyle = "#ff4d8d";
    ctx.fillText("❤ HumanCrush.com", W / 2, H - 54);
    ctx.textAlign = "left";
  };

  const videoStream = canvas.captureStream(30);
  const stream = new MediaStream([...videoStream.getVideoTracks(), ...audioTracks]);
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
    ? "video/webm;codecs=vp9,opus"
    : "video/webm";
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const done = new Promise<string>((resolve, reject) => {
    rec.onstop = async () => {
      try {
        actx?.close();
        const blob = new Blob(chunks, { type: "video/webm" });
        resolve(await blobToDataUrl(blob));
      } catch (e) {
        reject(e as Error);
      }
    };
  });

  rec.start();
  audioEl?.play().catch(() => {});
  const start = performance.now();
  await new Promise<void>((resolve) => {
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      draw(t);
      if (t < 1) requestAnimationFrame(frame);
      else {
        setTimeout(() => {
          rec.stop();
          resolve();
        }, 120);
      }
    };
    requestAnimationFrame(frame);
  });

  return done;
}
