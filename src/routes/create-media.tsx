import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { standaloneGenerate, unlockCreatorModel } from "@/lib/standalone-media.functions";
import { checkMediaJob } from "@/lib/media.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getEffectiveCompanionReel } from "@/lib/reels";

export const Route = createFileRoute("/create-media")({ ssr: false, component: Creator });

function Creator() {
  const navigate = useNavigate();
  const run = useServerFn(standaloneGenerate);
  const unlock = useServerFn(unlockCreatorModel);
  const checkJob = useServerFn(checkMediaJob);
  const [models, setModels] = useState<any[]>([]), [model, setModel] = useState("");
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState("");
  const [kind, setKind] = useState<"image" | "video">("image"), [prompt, setPrompt] = useState("");
  const [seconds, setSeconds] = useState(5), [size, setSize] = useState("portrait"), [busy, setBusy] = useState(false);
  const [unlocked, setUnlocked] = useState<string[]>([]), [modelSearch, setModelSearch] = useState("");
  const [activeJob, setActiveJob] = useState<any>(null), [library, setLibrary] = useState<any[]>([]), [showPrompt, setShowPrompt] = useState(true), [identityLocked, setIdentityLocked] = useState(true), [previewModel, setPreviewModel] = useState<any>(null);

  async function loadLibrary() {
    const { data: conversations } = await supabase.from("conversations").select("id").eq("title", "Creator render");
    const ids = (conversations ?? []).map((row: any) => row.id);
    if (!ids.length) { setLibrary([]); return; }
    const { data } = await supabase.from("media_jobs").select("id,kind,status,media_url,prompt,created_at,error").in("conversation_id", ids).order("created_at", { ascending: false }).limit(30);
    const rows = data ?? [], pending = rows.find((row: any) => ["pending", "processing"].includes(row.status));
    if (pending) setActiveJob(pending);
    setLibrary(rows.filter((row: any) => row.status === "completed" && row.media_url));
  }

  useEffect(() => {
    let active = true;
    supabase.from("companions").select("id,name,image_url,gender").order("sort_order").then(async ({ data, error }) => {
      if (!active) return;
      if (error) setLoadError("Models could not be loaded. Refresh and try again.");
      setModels(data ?? []);
      const requested = new URLSearchParams(window.location.search).get("model");
      if (data?.[0]) setModel(requested && data.some((item: any) => item.id === requested) ? requested : data[0].id);
      const ids = await (supabase as any).from("creator_model_unlocks").select("companion_id");
      setUnlocked((ids.data ?? []).map((row: any) => row.companion_id)); setLoading(false);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => { loadLibrary(); }, []);
  useEffect(() => {
    if (!activeJob || ["completed", "failed"].includes(activeJob.status)) return;
    const timer = window.setInterval(async () => { try { const result: any = await checkJob({ data: { jobId: activeJob.id } }); setActiveJob((old: any) => ({ ...old, ...result })); if (["completed", "failed"].includes(result.status)) { await loadLibrary(); if (result.status === "completed") toast.success("Your render is ready."); } } catch { /* retry */ } }, 4000);
    return () => window.clearInterval(timer);
  }, [activeJob?.id, activeJob?.status]);

  const visibleModels = models.filter((item) => item.name.toLowerCase().includes(modelSearch.trim().toLowerCase()));
  const sizes = { portrait: [768, 1024], square: [1024, 1024], landscape: [1024, 768] } as const;
  const cost = kind === "image" ? 8 : Math.max(10, seconds * 3);
  const reelFor = (item: any) => getEffectiveCompanionReel(item);
  const inspirationModes = ["Character swap", "Collab", "Image to video", "Recreate a photo", "Portrait remix", "Scene variation"];
  async function submit() {
    const selectedModel = model || models[0]?.id;
    if (!selectedModel) return toast.error("Models are still loading.");
    if (identityLocked && (models.find((item) => item.id === model) && models[0]?.id !== model && !unlocked.includes(model))) return toast.error("Unlock this model before generating.");
    if (prompt.trim().length < 3) return toast.error("Describe the render.");
    setBusy(true);
    try { const [width, height] = sizes[size as keyof typeof sizes]; const result = await run({ data: { companionId: selectedModel, prompt, kind, seconds, width, height } }); setActiveJob({ id: result.jobId, kind, status: "pending" }); toast.success(`Generation started (${result.cost} credits)`); setPrompt(""); }
    catch (error: any) { if (String(error?.message ?? error).includes("OUT_OF_CREDITS")) { navigate({ to: "/credits", search: { returnTo: "/create-media" } as never }); return; } toast.error(error?.message ?? "Generation failed"); }
    finally { setBusy(false); }
  }

  const jobCard = activeJob && <section className="mt-5 rounded-2xl border border-white/10 bg-[#252328] p-4 shadow-xl"><div className="flex items-center justify-between"><h2 className="font-bold">{activeJob.status === "completed" ? "Your render is ready" : activeJob.status === "failed" ? "Render failed" : "Creating your media..."}</h2><span className="text-xs uppercase text-pink-200">{activeJob.kind}</span></div>{!["completed", "failed"].includes(activeJob.status) && <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-pink-400 to-violet-400" /></div>}{activeJob.error && <p className="mt-2 text-sm text-red-200">{activeJob.error}</p>}{activeJob.mediaUrl && (activeJob.kind === "video" ? <video controls className="mt-4 max-h-[32rem] w-full rounded-xl bg-black" src={activeJob.mediaUrl} /> : <img className="mt-4 max-h-[32rem] w-full rounded-xl object-contain" src={activeJob.mediaUrl} />)}</section>;

  return <main className="creator-page min-h-screen bg-[#171717] px-4 py-6 text-white sm:px-8 sm:py-10"><div className="mx-auto max-w-6xl">{previewModel && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-5" onClick={() => setPreviewModel(null)}><div className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-white/20 bg-[#222] shadow-2xl" onClick={(e) => e.stopPropagation()}><button type="button" onClick={() => setPreviewModel(null)} className="absolute right-3 top-3 z-10 rounded-full bg-black/60 px-3 py-2 text-xs">Close</button><img src={previewModel.image_url} alt={previewModel.name} className="max-h-[65vh] w-full object-cover" /><div className="p-4"><h2 className="text-xl font-bold">{previewModel.name}</h2><p className="mt-1 text-sm text-white/60">{models[0]?.id === previewModel.id || unlocked.includes(previewModel.id) ? "Identity unlocked" : "Unlock this identity to keep the face consistent."}</p></div></div></div>}
    {!showPrompt ? <>
      <header className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.28em] text-pink-300">Creator</p><h1 className="mt-1 text-3xl font-black sm:text-4xl">Create</h1></div><div className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-xs text-white/60">Pay per render</div></header>
      <section className="mt-5 overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#e7463d] via-[#d83f68] to-[#712c69] p-6 shadow-2xl sm:p-12"><div className="mx-auto max-w-2xl text-center"><p className="text-sm font-semibold text-white/80">Custom prompt</p><h2 className="mt-3 text-3xl font-black sm:text-5xl">Bring any scene to life.</h2><p className="mx-auto mt-3 max-w-lg text-sm text-white/75 sm:text-base">Describe a photo or short video, choose an identity when you want a consistent face, and generate.</p><button type="button" onClick={() => setShowPrompt(true)} className="mt-6 rounded-full bg-white px-7 py-3 text-sm font-black text-[#a52c63] shadow-lg transition hover:scale-[1.02]">Open custom prompt</button></div></section>
      <section className="mt-10"><div className="flex items-end justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[0.3em] text-pink-300/80">Get inspired</p><h2 className="mt-2 text-3xl font-black tracking-tight">Choose a creation mode</h2></div><span className="text-xs text-white/40">Open Custom prompt to direct it</span></div><div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{visibleModels.slice(0, 12).map((item, index) => <button type="button" key={item.id} onClick={() => { setModel(item.id); setShowPrompt(true); }} className="group relative overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#242424] text-left shadow-lg">{reelFor(item) ? <video src={reelFor(item)!} autoPlay muted loop playsInline preload="metadata" className="aspect-[4/5] w-full object-cover" /> : <img src={item.image_url} alt={item.name} className="aspect-[4/5] w-full object-cover" />}<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/45 to-transparent p-4 pt-14"><span className="block text-base font-bold">{inspirationModes[index % inspirationModes.length]}</span><span className="mt-1 block text-xs text-white/60">Use {item.name} as the reference</span></div></button>)}</div></section>
    </> : <><div className="mb-5 flex items-center justify-between"><button type="button" onClick={() => { setPreviewModel(null); setShowPrompt(false); }} className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/70 hover:bg-white/10">Back</button><h1 className="text-xl font-black sm:text-2xl">Custom prompt</h1><span className="w-16" /></div>
      {jobCard}<div className="mt-4 grid gap-6 md:grid-cols-[220px_1fr]">
      <section className="rounded-2xl border border-white/10 bg-[#222] p-4 shadow-xl sm:p-6"><div className="grid grid-cols-2 gap-2"><Button variant={kind === "image" ? "default" : "outline"} onClick={() => setKind("image")}>Photo</Button><Button variant={kind === "video" ? "default" : "outline"} onClick={() => setKind("video")}>Video</Button></div><div className="mt-5"><p className="text-sm font-semibold">Frame size</p><div className="mt-2 flex flex-wrap gap-2">{Object.entries(sizes).map(([key, [width, height]]) => <button type="button" key={key} onClick={() => setSize(key)} className={`rounded-xl border px-3 py-2 text-xs font-semibold capitalize ${size === key ? "border-pink-400 bg-pink-400/15 text-pink-100" : "border-white/10 bg-black/20 text-white/60"}`}>{key} - {width}x{height}</button>)}</div></div>{kind === "video" && <div className="mt-5"><div className="flex items-center justify-between"><p className="text-sm font-semibold">Duration</p><span className="text-xs text-pink-200">{cost} credits</span></div><div className="mt-2 grid grid-cols-4 gap-2">{[3, 5, 8, 10].map((value) => <button type="button" key={value} onClick={() => setSeconds(value)} className={`rounded-xl border py-2 text-xs font-bold ${seconds === value ? "border-pink-300 bg-pink-400/20 text-pink-100" : "border-white/10 bg-black/20 text-white/55"}`}>{value}s</button>)}</div></div>}<div className="mt-5"><label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/50">Settings</label><div className="creator-identity-pills mb-4 flex gap-2 overflow-x-auto pb-1"><button type="button" onClick={() => { setModel(""); setIdentityLocked(false); }} className={`creator-identity-pill ${!model ? "selected" : ""}`}><span className="creator-random-avatar">✦</span><span>Random identity</span></button>{visibleModels.map((item) => <button type="button" key={`pill-${item.id}`} onClick={async () => { setPreviewModel(item); if (models[0]?.id !== item.id && !unlocked.includes(item.id)) { try { await unlock({ data: { companionId: item.id } }); setUnlocked((value) => [...value, item.id]); toast.success(`${item.name} unlocked for 50 credits`); } catch (error: any) { if (String(error?.message ?? error).includes("OUT_OF_CREDITS")) { navigate({ to: "/credits", search: { returnTo: "/create-media" } as never }); return; } toast.error(error?.message ?? "Unlock failed"); return; } } setModel(item.id); setIdentityLocked(true); }} className={`creator-identity-pill ${model === item.id ? "selected" : ""}`}><img src={item.image_url} alt="" /><span>{item.name}</span><small>{models[0]?.id === item.id || unlocked.includes(item.id) ? "Ready" : "Unlock · 50"}</small></button>)}</div><p className="mb-2 text-sm font-semibold">Describe the moment</p><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the pose, outfit, setting, lighting, and action..." className="min-h-36 w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none placeholder:text-white/30 focus:border-pink-400/60" /></div><Button disabled={busy || loading || !model} onClick={submit} className="mt-4 w-full bg-gradient-to-r from-pink-500 to-violet-500">{busy ? "Starting..." : `Generate - ${cost} credits`}</Button></section></div>
    <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.06] p-5"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.25em] text-pink-300">Your library</p><h2 className="mt-1 text-2xl font-black">Saved renders</h2></div><button onClick={loadLibrary} className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70">Refresh</button></div>{library.length === 0 ? <p className="mt-5 text-sm text-white/50">Completed images and videos will appear here.</p> : <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{library.map((item) => <article key={item.id} className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">{item.kind === "video" ? <video controls className="aspect-[3/4] w-full object-cover" src={item.media_url} /> : <img className="aspect-[3/4] w-full object-cover" src={item.media_url} />}</article>)}</div>}</section>
    </>}</div></main>;
}























