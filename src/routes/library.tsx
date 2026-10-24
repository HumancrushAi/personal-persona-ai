import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { isAccount } from "@/lib/account-user";
// Social jobs store an internal marker at the head of the prompt; never show it.
import { stripContentModeMarker } from "@/lib/social-safety";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Download, Heart, Image as ImageIcon, Play, RefreshCw, Trash2, Video, X } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { LogoLink } from "@/components/Logo";

const librarySearchSchema = z.object({
  type: z.enum(["all", "photos", "videos", "favourites"]).optional(),
  model: z.string().optional(),
  item: z.string().uuid().optional(),
});

export const Route = createFileRoute("/library")({
  ssr: false,
  validateSearch: (search) => librarySearchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Library | HumanCrush" },
      { name: "description", content: "Review, download, and remix your HumanCrush creator renders." },
    ],
  }),
  component: LibraryPage,
});

type Kind = "image" | "video" | "voice";
type Item = {
  id: string;
  kind: Kind;
  status: "pending" | "processing" | "completed" | "failed";
  media_url: string;
  prompt: string;
  created_at: string;
  error: string | null;
  modelName: string;
  companionId: string;
};
type FilterType = "all" | "photos" | "videos" | "favourites";

const PAGE_SIZE = 40;
const FAVOURITES_KEY = "hc:creator-library:favourites";

function libraryDate(date: string) {
  const value = new Date(date);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(start); yesterday.setDate(start.getDate() - 1);
  if (value >= start) return "Today";
  if (value >= yesterday) return "Yesterday";
  const week = new Date(start); week.setDate(start.getDate() - 7);
  if (value >= week) return "This week";
  return value.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatDate(date: string) {
  return new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function LibraryNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#121014]/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-2 px-3 sm:gap-3 sm:px-6">
        <LogoLink className="h-8 shrink-0" />
        <nav aria-label="Creator studio" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-1"><Link to="/create-media" className="rounded-full px-3 py-2 text-xs font-semibold text-[#B3A9B0] hover:bg-white/[0.06] hover:text-white sm:px-4 sm:text-sm">Create</Link><Link to="/library" className="rounded-full bg-white/[0.08] px-3 py-2 text-xs font-semibold text-white sm:px-4 sm:text-sm">Library</Link><Link to="/models" className="hidden rounded-full px-3 py-2 text-xs font-semibold text-[#B3A9B0] hover:bg-white/[0.06] hover:text-white sm:inline-flex sm:px-4 sm:text-sm">Models</Link></nav>
        <Link to="/create-media" className="ml-auto inline-flex min-h-9 items-center rounded-full bg-white px-3 text-xs font-bold text-[#121014] sm:min-h-10 sm:px-4 sm:text-sm">New render</Link>
      </div>
    </header>
  );
}

function LibraryPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [items, setItems] = useState<Item[]>([]);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [filter, setFilter] = useState<FilterType>(search.type ?? "all");
  const [modelFilter, setModelFilter] = useState(search.model ?? "all");
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [detail, setDetail] = useState<Item | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [favourites, setFavourites] = useState<string[]>([]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const detailHistoryRef = useRef(false);

  useEffect(() => {
    try { setFavourites(JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? "[]")); } catch { setFavourites([]); }
  }, []);

  async function loadPage(reset = false) {
    if (loading && !reset) return;
    setLoading(true);
    const { data: auth } = await supabase.auth.getUser();
    if (!isAccount(auth.user)) { navigate({ to: "/auth", search: { mode: "signin", redirect: "/library" } as never }); return; }
    const { data: conversations, error: conversationsError } = await supabase.from("conversations").select("id,personality_id").eq("user_id", auth.user.id).eq("title", "Creator render");
    if (conversationsError || !conversations?.length) { setItems(reset ? [] : items); setHasMore(false); setLoading(false); return; }
    const personalityIds = conversations.map((row) => row.personality_id);
    const { data: personalities } = await supabase.from("user_personalities").select("id,nickname,companion_id").in("id", personalityIds);
    const personalityMap = new Map((personalities ?? []).map((row) => [row.id, row]));
    const companionIds = [...new Set((personalities ?? []).map((row) => row.companion_id))];
    const { data: companions } = companionIds.length ? await supabase.from("companions").select("id,name").in("id", companionIds) : { data: [] };
    setModels((companions ?? []) as { id: string; name: string }[]);
    const companionMap = new Map((companions ?? []).map((row) => [row.id, row.name]));
    const conversationMap = new Map(conversations.map((row) => { const personality = personalityMap.get(row.personality_id); return [row.id, { companionId: personality?.companion_id ?? "", modelName: companionMap.get(personality?.companion_id ?? "") ?? personality?.nickname ?? "Model" }]; }));
    let query = supabase.from("media_jobs").select("id,kind,status,media_url,prompt,created_at,error,conversation_id").in("conversation_id", conversations.map((row) => row.id)).eq("status", "completed").not("media_url", "is", null).order("created_at", { ascending: false }).limit(PAGE_SIZE);
    if (!reset && cursor) query = query.lt("created_at", cursor);
    const { data, error } = await query;
    if (error) { setLoading(false); return; }
    const page = (data ?? []).map((row) => { const info = conversationMap.get(row.conversation_id ?? ""); return { ...row, prompt: stripContentModeMarker(row.prompt), media_url: row.media_url ?? "", modelName: info?.modelName ?? "Model", companionId: info?.companionId ?? "" } as Item; });
    setItems((current) => reset ? page : [...current, ...page]);
    setCursor(page.at(-1)?.created_at ?? null);
    setHasMore(page.length === PAGE_SIZE);
    setLoading(false);
  }

  useEffect(() => { void loadPage(true); }, []);

  // Recent work on /create-media deliberately stays compact (six cards). A
  // click always comes here, where the selected render opens inside the app
  // instead of navigating to its raw Supabase Storage URL.
  useEffect(() => {
    if (!search.item) return;
    const selectedItem = items.find((item) => item.id === search.item);
    if (selectedItem) setDetail(selectedItem);
  }, [items, search.item]);

  useEffect(() => {
    if (!detail || window.innerWidth >= 1024) return;
    window.history.pushState({ ...(window.history.state ?? {}), libraryDetail: detail.id }, "", window.location.href);
    detailHistoryRef.current = true;
    const onPopState = () => {
      detailHistoryRef.current = false;
      setDetail(null);
    };
    window.addEventListener("popstate", onPopState, { once: true });
    return () => window.removeEventListener("popstate", onPopState);
  }, [detail?.id]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("type", filter);
    if (modelFilter !== "all") params.set("model", modelFilter);
    if (search.item) params.set("item", search.item);
    window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
  }, [filter, modelFilter]);

  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return;
    const observer = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) void loadPage(); }, { rootMargin: "500px" });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, cursor]);

  const filteredItems = useMemo(() => items.filter((item) => {
    if (filter === "photos" && item.kind !== "image") return false;
    if (filter === "videos" && item.kind !== "video") return false;
    if (filter === "favourites" && !favourites.includes(item.id)) return false;
    if (modelFilter !== "all" && item.companionId !== modelFilter) return false;
    return true;
  }), [items, filter, modelFilter, favourites]);
  const grouped = useMemo(() => filteredItems.reduce<Record<string, Item[]>>((all, item) => { const group = libraryDate(item.created_at); (all[group] ??= []).push(item); return all; }, {}), [filteredItems]);

  function updateFilter(next: FilterType) { setFilter(next); setSelected([]); }
  function toggleFavourite(id: string) { const next = favourites.includes(id) ? favourites.filter((value) => value !== id) : [...favourites, id]; setFavourites(next); localStorage.setItem(FAVOURITES_KEY, JSON.stringify(next)); }
  function toggleSelected(id: string) { setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); }
  function closeDetail() { if (detailHistoryRef.current) window.history.back(); else setDetail(null); }
  async function download(item: Item) { try { const response = await fetch(item.media_url); if (!response.ok) throw new Error(); const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = `humancrush-${item.kind}-${item.id}.${item.kind === "video" ? "mp4" : "png"}`; link.click(); URL.revokeObjectURL(url); } catch { window.open(item.media_url, "_blank", "noopener,noreferrer"); } }
  async function downloadSelected() { for (const id of selected) { const item = items.find((value) => value.id === id); if (item) await download(item); } }

  return (
    <div className="min-h-screen bg-[#121014] text-[#F5EFF2]"><LibraryNav /><main className="mx-auto max-w-[1240px] px-4 py-10 pb-16 sm:px-6 sm:py-14"><div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-sm font-semibold text-[#D4D4D8]">Creator studio</p><h1 className="mt-2 font-display text-4xl font-extrabold tracking-[-.035em] sm:text-5xl">Library</h1><p className="mt-2 text-sm text-[#B3A9B0]">{filteredItems.length} of {items.length} renders shown. Newest first.</p></div><div className="flex gap-2"><button type="button" onClick={() => setSelecting((value) => !value)} className="min-h-11 rounded-full border border-white/[0.14] px-4 text-sm font-semibold hover:bg-white/[0.06]">{selecting ? "Done" : "Select"}</button><button type="button" onClick={() => void loadPage(true)} aria-label="Refresh library" className="grid h-11 w-11 place-items-center rounded-full border border-white/[0.14] hover:bg-white/[0.06]"><RefreshCw className="h-4 w-4" /></button></div></div>
      <div className="mt-8 flex flex-wrap items-center gap-2"><div role="radiogroup" aria-label="Render type" className="flex flex-wrap gap-1 rounded-full bg-white/[0.06] p-1">{(["all", "photos", "videos", "favourites"] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={filter === value} onClick={() => updateFilter(value)} className={`min-h-10 rounded-full px-3 text-xs font-semibold capitalize sm:px-4 ${filter === value ? "bg-white text-[#121014]" : "text-[#B3A9B0] hover:text-white"}`}>{value}</button>)}</div><div className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-white/[0.06] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"><button type="button" onClick={() => setModelFilter("all")} className={`min-h-10 shrink-0 rounded-full px-3 text-xs font-semibold ${modelFilter === "all" ? "bg-white text-[#121014]" : "text-[#B3A9B0]"}`}>All models</button>{models.map((model) => <button type="button" key={model.id} onClick={() => setModelFilter(model.id)} className={`min-h-10 shrink-0 rounded-full px-3 text-xs font-semibold ${modelFilter === model.id ? "bg-white text-[#121014]" : "text-[#B3A9B0]"}`}>{model.name}</button>)}</div></div>
      {selecting && <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[14px] border border-white/[0.08] bg-[#1C191E] px-4 py-3 text-sm"><span className="text-[#B3A9B0]">{selected.length} selected</span><button type="button" disabled={!selected.length} onClick={() => void downloadSelected()} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white px-4 text-xs font-bold text-[#121014] disabled:opacity-40"><Download className="h-4 w-4" /> Download</button><span className="inline-flex items-center gap-2 text-xs text-[#8E858C]"><Trash2 className="h-4 w-4" /> Delete is unavailable for saved renders</span></div>}
      {loading && items.length === 0 ? <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"><div className="aspect-[4/5] animate-pulse rounded-[14px] bg-[#1C191E]" /><div className="aspect-[4/5] animate-pulse rounded-[14px] bg-[#1C191E]" /><div className="aspect-[4/5] animate-pulse rounded-[14px] bg-[#1C191E]" /></div> : filteredItems.length === 0 ? <div className="mt-10 rounded-[20px] border border-dashed border-white/[0.12] bg-[#1C191E] p-12 text-center"><ImageIcon className="mx-auto h-8 w-8 text-[#8E858C]" /><h2 className="mt-4 font-display text-2xl font-bold">Nothing matches this filter yet.</h2><p className="mt-2 text-sm text-[#B3A9B0]">Create a render and it will appear here.</p><Link to="/create-media" className="mt-5 inline-flex min-h-11 items-center rounded-full bg-[#FF4D6A] px-5 text-sm font-bold text-[#1A0A0F]">Create a render</Link></div> : <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]"><div className="space-y-8">{Object.entries(grouped).map(([group, groupItems]) => <section key={group}><h2 className="mb-3 font-display text-lg font-bold text-[#B3A9B0]">{group}</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{groupItems.map((item) => <article key={item.id} className={`group relative overflow-hidden rounded-[14px] border bg-[#1C191E] ${selected.includes(item.id) ? "border-[#FF4D6A] ring-2 ring-[#FF4D6A]/30" : "border-white/[0.08]"}`}><button type="button" onClick={() => selecting ? toggleSelected(item.id) : setDetail(item)} className="block w-full text-left"><div className="relative aspect-[4/5] overflow-hidden">{item.kind === "video" ? <video muted preload="metadata" src={item.media_url} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /> : <img src={item.media_url} alt={`${item.modelName} render`} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />}<span className="absolute left-2 top-2 rounded-full bg-[#121014]/80 px-2 py-1 text-[10px] font-semibold">{item.kind === "video" ? "Video" : "Photo"}</span>{selecting && <span className={`absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full border ${selected.includes(item.id) ? "border-[#FF4D6A] bg-[#FF4D6A] text-[#1A0A0F]" : "border-white/50 bg-black/40"}`}>{selected.includes(item.id) && <span>✓</span>}</span>}</div><div className="p-3"><p className="truncate text-sm font-semibold">{item.modelName}</p><p className="mt-1 line-clamp-2 text-xs text-[#8E858C]">{item.prompt}</p></div></button><button type="button" aria-label={favourites.includes(item.id) ? "Remove from favourites" : "Add to favourites"} onClick={() => toggleFavourite(item.id)} className="absolute bottom-3 right-3 grid h-9 w-9 place-items-center rounded-full bg-[#121014]/80 text-[#FF7A90]"> <Heart className={`h-4 w-4 ${favourites.includes(item.id) ? "fill-current" : ""}`} /></button></article>)}</div></section>)}</div><aside className="hidden lg:block">{detail ? <DetailPanel item={detail} favourite={favourites.includes(detail.id)} onClose={() => setDetail(null)} onFavourite={() => toggleFavourite(detail.id)} onDownload={() => void download(detail)} onRemix={() => navigate({ to: "/create-media", search: { prompt: detail.prompt, model: detail.companionId } as never })} /> : <div className="sticky top-24 rounded-[20px] border border-dashed border-white/[0.12] bg-[#1C191E] p-6 text-sm text-[#8E858C]">Select a render to inspect its prompt, remix it, or download the original.</div>}</aside></div>}
      {detail && <div className="fixed inset-0 z-50 flex items-end bg-black/70 p-3 lg:hidden" onClick={closeDetail}><div className="max-h-[85vh] w-full overflow-y-auto rounded-[20px] border border-white/[0.12] bg-[#1C191E]" onClick={(event) => event.stopPropagation()}><DetailPanel item={detail} favourite={favourites.includes(detail.id)} onClose={closeDetail} onBack={closeDetail} onFavourite={() => toggleFavourite(detail.id)} onDownload={() => void download(detail)} onRemix={() => navigate({ to: "/create-media", search: { prompt: detail.prompt, model: detail.companionId } as never })} /></div></div>}
      <div ref={sentinelRef} className="h-12" />
      {!hasMore && items.length > 0 && <p className="text-center text-xs text-[#8E858C]">You have reached the end of your library.</p>}
    </main></div>
  );
}

function DetailPanel({ item, favourite, onClose, onBack, onFavourite, onDownload, onRemix }: { item: Item; favourite: boolean; onClose: () => void; onBack?: () => void; onFavourite: () => void; onDownload: () => void; onRemix: () => void }) {
  return <div className="p-4 sm:p-5"><div className="mb-4 grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2">{onBack ? <button type="button" aria-label="Back" onClick={onBack} className="grid h-11 w-11 place-items-center rounded-full border border-white/[0.12] hover:bg-white/[0.06]"><ChevronLeft className="h-5 w-5" /></button> : <span aria-hidden="true" />}<div><p className="text-xs font-semibold text-[#FF7A90]">{item.kind === "video" ? "Video" : "Photo"} of {item.modelName}</p><p className="mt-1 text-xs text-[#8E858C]">{formatDate(item.created_at)}</p></div><button type="button" aria-label="Close details" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/[0.06]"><X className="h-4 w-4" /></button></div>{item.kind === "video" ? <video controls src={item.media_url} className="aspect-[4/5] w-full rounded-[14px] bg-black object-cover" /> : <img src={item.media_url} alt={`${item.modelName} render`} className="aspect-[4/5] w-full rounded-[14px] object-cover" />}<p className="mt-4 text-sm leading-relaxed text-[#B3A9B0]">{item.prompt}</p><div className="mt-5 grid gap-2 sm:grid-cols-3"><button type="button" onClick={onRemix} className="min-h-11 rounded-[14px] bg-[#FF4D6A] text-xs font-bold text-[#1A0A0F]">Remix</button><button type="button" onClick={onDownload} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] border border-white/[0.14] text-xs font-semibold"><Download className="h-4 w-4" /> Download</button><button type="button" onClick={onFavourite} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] border border-white/[0.14] text-xs font-semibold"><Heart className={`h-4 w-4 text-[#FF7A90] ${favourite ? "fill-current" : ""}`} /> {favourite ? "Saved" : "Favourite"}</button></div>{item.kind === "image" && <Link to="/create-media" search={{ prompt: item.prompt, model: item.companionId } as never} className="mt-2 inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-[14px] border border-white/[0.14] text-xs font-semibold"><Video className="h-4 w-4" /> Make video</Link>}</div>;
}
