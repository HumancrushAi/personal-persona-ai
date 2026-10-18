import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { standaloneGenerate, unlockCreatorModel } from "@/lib/standalone-media.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/create-media")({ ssr: false, component: Creator });

function Creator() {
  const run = useServerFn(standaloneGenerate);
  const unlock = useServerFn(unlockCreatorModel);
  const [models, setModels] = useState<any[]>([]);
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [kind, setKind] = useState<"image" | "video">("image");
  const [prompt, setPrompt] = useState("");
  const [seconds, setSeconds] = useState(5);
  const [size, setSize] = useState("portrait");
  const [busy, setBusy] = useState(false);
  const [unlocked, setUnlocked] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    supabase.from("companions").select("id,name,image_url,gender").order("sort_order").then(async ({ data, error }) => {
      if (!active) return;
      if (error) setLoadError("Models could not be loaded. Refresh and try again.");
      setModels(data ?? []);
      if (data?.[0]) setModel(data[0].id);
      const ids = await (supabase as any).from("creator_model_unlocks").select("companion_id");
      setUnlocked((ids.data ?? []).map((row: any) => row.companion_id));
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const cost = kind === "image" ? 8 : Math.max(10, seconds * 3);
  const sizes = { portrait: [768, 1024], square: [1024, 1024], landscape: [1024, 768] } as const;
  async function submit() {
    if (!model || (models.find((item) => item.id === model) && models[0]?.id !== model && !unlocked.includes(model))) return toast.error("Unlock this model before generating.");
    if (prompt.trim().length < 3) return toast.error("Describe the render.");
    setBusy(true);
    try {
      const [width, height] = sizes[size as keyof typeof sizes];
      const result = await run({ data: { companionId: model, prompt, kind, seconds, width, height } });
      toast.success(`Generation started (${result.cost} credits)`);
      setPrompt("");
    } catch (error: any) {
      toast.error(error?.message ?? "Generation failed");
    } finally { setBusy(false); }
  }

  return <main className="relative isolate min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_right,#7c2856_0,transparent_35%),radial-gradient(circle_at_bottom_left,#182b58_0,transparent_38%),#100f18] px-5 py-10 text-white">
    <div className="pointer-events-none absolute -left-20 top-20 -z-10 h-72 w-72 rounded-full bg-pink-500/15 blur-3xl" />
    <div className="mx-auto max-w-5xl"><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.25em] text-pink-300">Creator studio</p><h1 className="mt-2 text-3xl font-black">Create media</h1><p className="mt-2 text-white/65">Pick the model identity, frame, and action. Every render keeps that model as its reference.</p></div><div className="hidden rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-right sm:block"><p className="text-xs text-white/50">Your balance</p><p className="font-bold text-pink-200">Credits wallet</p></div></div>
    <div className="mt-8 grid gap-6 md:grid-cols-[260px_1fr]">
      <div className="space-y-3"><p className="text-sm font-semibold text-white/80">Choose your model</p>
        {loading && <p className="rounded-xl border border-white/10 p-3 text-sm text-white/60">Loading models…</p>}
        {loadError && <p className="rounded-xl border border-red-400/30 p-3 text-sm text-red-200">{loadError}</p>}
        {!loading && !loadError && !models.length && <p className="rounded-xl border border-white/10 p-3 text-sm text-white/60">No models are available yet.</p>}
        {models.map((item, index) => <div key={item.id} className={`flex items-center gap-2 rounded-2xl border bg-white/[0.04] p-2 ${model === item.id ? "border-pink-400 bg-pink-400/10" : "border-white/10"}`}><button onClick={() => setModel(item.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><img src={item.image_url} className="h-14 w-14 rounded-xl object-cover" /><span><strong className="block">{item.name}</strong><small className="text-white/45">{item.gender === "male" ? "Male model" : "Female model"}</small></span></button>{(index === 0 || unlocked.includes(item.id)) ? <span className="px-2 text-xs text-emerald-300">Unlocked</span> : <button onClick={async () => { try { await unlock({ data: { companionId: item.id } }); setUnlocked((value) => [...value, item.id]); setModel(item.id); toast.success(`${item.name} unlocked for 50 credits`); } catch (error: any) { toast.error(error?.message ?? "Could not unlock model"); } }} className="rounded-full bg-gradient-to-r from-amber-400 to-pink-500 px-3 py-1.5 text-xs font-bold text-black">Unlock · 50</button>}</div>)}
      </div>
      <section className="rounded-3xl border border-white/10 bg-white/[0.07] p-5 shadow-2xl backdrop-blur sm:p-7">
        <div className="flex gap-2"><Button variant={kind === "image" ? "default" : "outline"} onClick={() => setKind("image")}>Image · 8 credits</Button><Button variant={kind === "video" ? "default" : "outline"} onClick={() => setKind("video")}>Video</Button></div>
        <div className="mt-5"><p className="text-sm font-semibold text-white/80">Frame size</p><div className="mt-2 flex flex-wrap gap-2">{Object.entries(sizes).map(([key, [width, height]]) => <button type="button" key={key} onClick={() => setSize(key)} className={`rounded-xl border px-3 py-2 text-xs font-semibold capitalize ${size === key ? "border-pink-400 bg-pink-400/15 text-pink-100" : "border-white/10 bg-black/20 text-white/60"}`}>{key} · {width}×{height}</button>)}</div></div>
        {kind === "video" && <label className="mt-5 block text-sm">Duration: <select value={seconds} onChange={(event) => setSeconds(Number(event.target.value))} className="ml-2 rounded bg-black p-2">{[3, 5, 8, 10, 12, 15, 20, 25, 30].map((value) => <option key={value}>{value}</option>)}</select> seconds · {cost} credits</label>}
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the image or video…" className="mt-5 min-h-40 w-full rounded-xl border border-white/10 bg-black/30 p-4" />
        <Button disabled={busy || loading || !model} onClick={submit} className="mt-4 w-full bg-gradient-to-r from-pink-500 to-violet-500">{busy ? "Starting…" : `Generate · ${cost} credits`}</Button>
      </section>
    </div>
    </div></main>;
}
