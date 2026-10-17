import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { standaloneGenerate } from "@/lib/standalone-media.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/create-media")({ ssr: false, component: Creator });

function Creator() {
  const run = useServerFn(standaloneGenerate);
  const [models, setModels] = useState<any[]>([]); const [model, setModel] = useState("");
  const [kind, setKind] = useState<"image" | "video">("image"); const [prompt, setPrompt] = useState("");
  const [seconds, setSeconds] = useState(5); const [busy, setBusy] = useState(false);
  useEffect(() => { supabase.from("companions").select("id,name,image_url,gender").order("sort_order").then(({data}) => { setModels(data ?? []); if (data?.[0]) setModel(data[0].id); }); }, []);
  const cost = kind === "image" ? 8 : Math.max(10, seconds * 3);
  async function submit() { if (!model || prompt.trim().length < 3) return toast.error("Choose a model and describe the render."); setBusy(true); try { const r = await run({ data: { companionId: model, prompt, kind, seconds, width: 768, height: 1024 } }); toast.success(`Generation started (${r.cost} credits)`); setPrompt(""); } catch (e: any) { toast.error(e.message ?? "Generation failed"); } finally { setBusy(false); } }
  return <main className="mx-auto min-h-screen max-w-5xl px-5 py-10 text-white"><h1 className="text-3xl font-bold">Create media</h1><p className="mt-2 text-white/60">Generate independently from chat. Credits are charged only when the job starts.</p><div className="mt-8 grid gap-6 md:grid-cols-[260px_1fr]"><div className="space-y-2">{models.map(m => <button key={m.id} onClick={() => setModel(m.id)} className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left ${model === m.id ? "border-pink-400" : "border-white/10"}`}><img src={m.image_url} className="h-12 w-12 rounded-lg object-cover"/><span>{m.name}</span></button>)}</div><section className="rounded-2xl border border-white/10 bg-white/5 p-5"><div className="flex gap-2"><Button variant={kind === "image" ? "default" : "outline"} onClick={() => setKind("image")}>Image · 8 credits</Button><Button variant={kind === "video" ? "default" : "outline"} onClick={() => setKind("video")}>Video</Button></div>{kind === "video" && <label className="mt-5 block">Duration: <select value={seconds} onChange={e => setSeconds(Number(e.target.value))} className="ml-2 rounded bg-black p-2">{[3,5,8,10,12,15,20,25,30].map(s => <option key={s}>{s}</option>)}</select> seconds · {cost} credits</label>}<textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Describe the image or video…" className="mt-5 min-h-40 w-full rounded-xl border border-white/10 bg-black/30 p-4"/><Button disabled={busy} onClick={submit} className="mt-4 w-full">{busy ? "Starting…" : `Generate · ${cost} credits`}</Button></section></div></main>;
}
