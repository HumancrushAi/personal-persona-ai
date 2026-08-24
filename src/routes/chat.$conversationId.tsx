import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { companionImage } from "@/lib/companion-images";
import { sendChatMessage } from "@/lib/chat.functions";
import {
  generateSelfie,
  generateVoiceNote,
  requestVideo,
  checkMediaJob,
} from "@/lib/media.functions";
import { MediaRequestModal, type MediaKind } from "@/components/MediaRequestModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Send,
  Coins,
  Image as ImageIcon,
  Mic,
  Video as VideoIcon,
  Heart,
  Sparkles,
  Circle,
} from "lucide-react";
import { toast } from "sonner";
import { getScenario } from "@/lib/scenarios";
import { getCompanionReel, companionReelUrl, getEffectiveCompanionReel } from "@/lib/reels";

export const Route = createFileRoute("/chat/$conversationId")({
  ssr: false,
  head: () => ({ meta: [{ title: "Chat — HumanCrush.com" }] }),
  component: ChatPage,
});

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  kind?: string | null;
  media_url?: string | null;
  created_at?: string | null;
};

type LocalPendingJob = {
  id: string;
  kind: "photo" | "video";
  conversationId: string;
  created_at: string;
  dbJobId?: string;
};

function ChatPage() {
  const { conversationId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const send = useServerFn(sendChatMessage);
  const selfie = useServerFn(generateSelfie);
  const voiceFn = useServerFn(generateVoiceNote);
  const requestVideoFn = useServerFn(requestVideo);
  const checkJob = useServerFn(checkMediaJob);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState<"selfie" | "voice" | "video" | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeImageUrl, setActiveImageUrl] = useState<string | null>(null);
  // Which media request dialog is open, if any.
  const [asking, setAsking] = useState<MediaKind | null>(null);
  // Seconds elapsed on the running job. Generation takes 90s+, and a static
  // "taking a pic for you…" with no movement reads as a hang — people gave up
  // and assumed it was broken while the job was in fact still running.
  const [waited, setWaited] = useState(0);

  const [localJobs, setLocalJobs] = useState<LocalPendingJob[]>([]);

  // Helper to save to localStorage
  const saveLocalJobs = (jobs: LocalPendingJob[]) => {
    try {
      localStorage.setItem(`hc_local_jobs_${conversationId}`, JSON.stringify(jobs));
    } catch (e) {
      console.error("Failed to save local pending jobs", e);
    }
  };

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`hc_local_jobs_${conversationId}`);
      if (stored) {
        const parsed = JSON.parse(stored) as LocalPendingJob[];
        // Filter out jobs older than 10 minutes to prevent stales
        const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
        const valid = parsed.filter((j) => new Date(j.created_at).getTime() > tenMinutesAgo);
        setLocalJobs(valid);
        saveLocalJobs(valid);
      }
    } catch (e) {
      console.error("Failed to parse local pending jobs", e);
    }
  }, [conversationId]);

  useEffect(() => {
    if (!mediaBusy) {
      setWaited(0);
      return;
    }
    const started = Date.now();
    const t = setInterval(() => setWaited(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [mediaBusy]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) navigate({ to: "/auth" });
    });
  }, []);

  const { data: conv } = useQuery({
    queryKey: ["conv-meta", conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select(
          "id, personality_id, scenario, relationship_level, relationship_xp, user_personalities(nickname, companion_id, companions(name, image_url))",
        )
        .eq("id", conversationId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: messages } = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, role, content, kind, media_url, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Message[];
    },
    // Media lands in the chat from the server (webhook or a reconcile tick),
    // which can happen after this tab has stopped watching the job — a video
    // took 4m16s while the poll gave up at 3m, so the photo and clip were
    // already sitting in the conversation and the page simply never re-read it.
    // Refetching keeps late arrivals from needing a manual reload. Paused when
    // the tab is hidden, so it costs nothing in the background.
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  const { data: pendingJobs } = useQuery({
    queryKey: ["pending-jobs", conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("media_jobs")
        .select("id, kind, status, created_at")
        .eq("conversation_id", conversationId)
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    refetchInterval: 3000,
  });

  // Clean up completed/failed local jobs based on database status updates
  useEffect(() => {
    if (!pendingJobs) return;
    setLocalJobs((prev) => {
      const next = prev.filter((j) => {
        if (!j.dbJobId) {
          // If it has no dbJobId, keep it only if it is less than 2 minutes old
          return Date.now() - new Date(j.created_at).getTime() < 120_000;
        }
        // If it has dbJobId, keep it only if it is still in the database pendingJobs list
        return pendingJobs.some((db) => db.id === j.dbJobId);
      });
      if (next.length !== prev.length) {
        saveLocalJobs(next);
      }
      return next;
    });
  }, [pendingJobs]);

  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const pendingMessages = (pendingJobs ?? []).map((job) => ({
    id: `pending-job-${job.id}`,
    role: "assistant" as const,
    content: "",
    kind: job.kind === "image" ? "image_pending" : job.kind === "video" ? "video_pending" : "voice_pending",
    media_url: null,
    created_at: job.created_at,
    jobId: job.id,
  }));

  const localPendingMessages = localJobs
    .filter((j) => !j.dbJobId || !pendingJobs?.some((db) => db.id === j.dbJobId))
    .map((j) => ({
      id: `local-pending-job-${j.id}`,
      role: "assistant" as const,
      content: "",
      kind: (j.kind === "photo" ? "image_pending" : "video_pending") as any,
      media_url: null,
      created_at: j.created_at,
      jobId: j.id,
    }));

  const allMessages = [...(messages ?? []), ...pendingMessages, ...localPendingMessages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const messageIds = allMessages.map((m) => m.id).join(",");

  const { data: balance } = useQuery({
    queryKey: ["balance"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase
        .from("credit_balances")
        .select("free_messages_remaining, paid_credits")
        .eq("user_id", u.user.id)
        .maybeSingle();
      return data;
    },
  });

  // Seed opener from scenario if chat is empty
  const scenario = getScenario((conv as any)?.scenario);
  const p: any = conv?.user_personalities;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messageIds, sending, mediaBusy, pendingUser]);

  async function sendMessage(raw: string) {
    const content = raw.trim();
    if (!content || sending) return;
    const total = (balance?.free_messages_remaining ?? 0) + (balance?.paid_credits ?? 0);
    if (total <= 0) {
      toast.error("You're out of credits");
      navigate({ to: "/credits" });
      return;
    }
    setSending(true);
    setPendingUser(content); // show my message instantly
    const start = Date.now();
    try {
      const res = await send({ data: { conversationId, content } });

      const target = (res as any)?.typingDelayMs ?? 3000;
      const elapsed = Date.now() - start;
      if (elapsed < target) await new Promise((r) => setTimeout(r, target - elapsed));

      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["conv-meta", conversationId] });
      qc.invalidateQueries({ queryKey: ["pending-jobs", conversationId] });
      await qc.invalidateQueries({ queryKey: ["messages", conversationId] });
      setPendingUser(null); // real messages are loaded now — drop the optimistic bubble
      if (res?.relationship?.leveledUp) {
        toast.success(`💖 Relationship level up — now level ${res.relationship.level}`);
      }
      // Auto photo/video queued from the message itself — watch the job in the
      // background; the media lands in the chat via the webhook.
      const autoJobId = (res as any)?.jobId;
      if (autoJobId) {
        const label = (res as any)?.kind === "video_pending" ? "video" : "photo";
        pollMediaJob(autoJobId, label).catch((e: any) =>
          toast.error(e?.message ?? `${label === "video" ? "Video" : "Photo"} generation failed`),
        );
      }
    } catch (err: any) {
      const msg = err?.message ?? "Error";
      if (msg.includes("OUT_OF_CREDITS")) {
        toast.error("Out of credits");
        navigate({ to: "/credits" });
      } else if (msg.includes("BLOCKED_CONTENT")) {
        toast.error(msg.split("BLOCKED_CONTENT:")[1]?.trim() || "That request isn't allowed.");
      } else toast.error(msg);
      setInput(content);
      setPendingUser(null);
    } finally {
      setSending(false);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const content = input.trim();
    if (!content) return;
    setInput("");
    await sendMessage(content);
  }

  // Auto-send a message carried over from the home-page tease chat.
  const sentPending = useRef(false);
  useEffect(() => {
    if (sentPending.current || sending) return;
    if (balance === undefined) return; // wait until credits are loaded
    let pending = "";
    try {
      pending = sessionStorage.getItem("hc_pending_msg") || "";
    } catch {
      /* private mode */
    }
    if (pending) {
      sentPending.current = true;
      try {
        sessionStorage.removeItem("hc_pending_msg");
      } catch {
        /* ignore */
      }
      sendMessage(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balance]);

  // Drive an async media job to completion by asking the server to reconcile it
  // against Replicate each tick — completion does NOT rely on the webhook.
  // Resolves on completion/timeout; throws on failure.
  async function pollMediaJob(jobId: string, label: "photo" | "video") {
    let attempts = 0;
    // 90 ticks was three minutes, which a 10s clip plus queue time runs past —
    // the poll gave up while the job was still healthy and the media only
    // arrived if the webhook happened to land. Videos get eight minutes.
    const maxAttempts = label === "video" ? 240 : 150;
    try {
      while (attempts < maxAttempts) {
        let res: any;
        try {
          res = await checkJob({ data: { jobId } });
        } catch {
          res = null; // transient — keep polling
        }
        if (res?.status === "completed") {
          qc.invalidateQueries({ queryKey: ["pending-jobs", conversationId] });
          await qc.invalidateQueries({ queryKey: ["messages", conversationId] });
          await qc.invalidateQueries({ queryKey: ["balance"] });
          toast.success(label === "video" ? "Video received!" : "Photo received!");
          return;
        }
        if (res?.status === "failed") {
          qc.invalidateQueries({ queryKey: ["pending-jobs", conversationId] });
          throw new Error("Generation failed");
        }
        await new Promise((r) => setTimeout(r, 2000));
        attempts++;
      }
      // Now literally true: the messages query polls, so whenever the server
      // finishes it the media drops into the conversation on its own.
      toast.info(`She is still working on that ${label}. It'll appear here as soon as it's ready.`);
    } finally {
      setLocalJobs((prev) => {
        const next = prev.filter((j) => j.dbJobId !== jobId);
        saveLocalJobs(next);
        return next;
      });
    }
  }

  // Pick up jobs left mid-flight. A closed tab, a dropped connection, or a
  // generation slower than the window above strands a job in "processing"
  // forever otherwise: the poll is what finalizes jobs now, the webhook is only
  // a best-effort fast path, and nothing else sweeps them. Re-polling here also
  // triggers the refund path for jobs whose prediction failed while away.
  const resumedFor = useRef<string | null>(null);
  useEffect(() => {
    if (resumedFor.current === conversationId) return;
    resumedFor.current = conversationId;
    (async () => {
      const { data: unfinished } = await supabase
        .from("media_jobs")
        .select("id, kind")
        .eq("conversation_id", conversationId)
        .in("status", ["pending", "processing"]);
      for (const job of unfinished ?? []) {
        pollMediaJob(job.id, job.kind === "video" ? "video" : "photo").catch(() => {
          /* already recorded on the job row — don't toast on load */
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // No dialog. Asking her for something in the message box is how you say what
  // you want — chat.functions reads the request and fires the job with it — and
  // this button is the wordless version of the same thing. A browser prompt in
  // the middle of a conversation breaks the illusion of talking to a person.
  // Both media buttons ask what you want first. Firing straight into a
  // generation meant the model picked the subject itself, which is how people
  // ended up paying 8 credits for "whatever it felt like".
  async function runSelfie(prompt: string) {
    setAsking(null);
    setMediaBusy("selfie");
    const localId = `local-job-${Date.now()}`;
    const newLocalJob: LocalPendingJob = {
      id: localId,
      kind: "photo",
      conversationId,
      created_at: new Date().toISOString(),
    };
    setLocalJobs((prev) => {
      const next = [...prev, newLocalJob];
      saveLocalJobs(next);
      return next;
    });

    try {
      const res = await selfie({ data: { conversationId, prompt } });
      const jobId = (res as any).jobId;
      setLocalJobs((prev) => {
        const next = prev.map((j) => (j.id === localId ? { ...j, dbJobId: jobId } : j));
        saveLocalJobs(next);
        return next;
      });
      setMediaBusy(null); // Clear early so placeholder in chat list takes over progress indicator
      qc.invalidateQueries({ queryKey: ["pending-jobs", conversationId] });
      await pollMediaJob(jobId, "photo");
    } catch (err: any) {
      setMediaBusy(null);
      setLocalJobs((prev) => {
        const next = prev.filter((j) => j.id !== localId);
        saveLocalJobs(next);
        return next;
      });
      const msg = err?.message ?? "Error";
      if (msg.includes("OUT_OF_CREDITS")) {
        toast.error("Not enough credits — selfies cost 8");
        navigate({ to: "/credits" });
      } else if (msg.includes("BLOCKED_CONTENT")) {
        toast.error("She can't take that kind of pic — no credits used.");
      } else toast.error(msg);
    }
  }

  async function handleVoice() {
    if (mediaBusy) return;
    const last = [...(messages ?? [])]
      .reverse()
      .find((m) => m.role === "assistant" && m.kind !== "voice");
    if (!last?.content) {
      toast.error("Need her to say something first");
      return;
    }
    setMediaBusy("voice");
    try {
      await voiceFn({ data: { conversationId, text: last.content.slice(0, 600) } });
      qc.invalidateQueries({ queryKey: ["messages", conversationId] });
      qc.invalidateQueries({ queryKey: ["balance"] });
    } catch (err: any) {
      const msg = err?.message ?? "Error";
      if (msg.includes("OUT_OF_CREDITS")) {
        toast.error("Not enough credits — voice notes cost 3");
        navigate({ to: "/credits" });
      } else toast.error(msg);
    } finally {
      setMediaBusy(null);
    }
  }

  // No dialog: this is a chat product. Asking her for a video in the message box
  // already generates one (chat.functions detects the request and fires the job
  // with whatever was said), and this button is the same thing without typing.
  async function runVideo(prompt: string, seconds: number) {
    setAsking(null);
    setMediaBusy("video");
    const localId = `local-job-${Date.now()}`;
    const newLocalJob: LocalPendingJob = {
      id: localId,
      kind: "video",
      conversationId,
      created_at: new Date().toISOString(),
    };
    setLocalJobs((prev) => {
      const next = [...prev, newLocalJob];
      saveLocalJobs(next);
      return next;
    });

    try {
      // Send the duration itself. This used to send a `settings` object that
      // the server no longer accepted, so zod stripped it and every clip came
      // back at the 5s default no matter what was picked.
      const res = await requestVideoFn({ data: { conversationId, prompt, seconds } });
      const jobId = (res as any).jobId;
      setLocalJobs((prev) => {
        const next = prev.map((j) => (j.id === localId ? { ...j, dbJobId: jobId } : j));
        saveLocalJobs(next);
        return next;
      });
      setMediaBusy(null); // Clear early so placeholder in chat list takes over progress indicator
      qc.invalidateQueries({ queryKey: ["pending-jobs", conversationId] });
      await pollMediaJob(jobId, "video");
    } catch (err: any) {
      setMediaBusy(null);
      setLocalJobs((prev) => {
        const next = prev.filter((j) => j.id !== localId);
        saveLocalJobs(next);
        return next;
      });
      const msg = err?.message ?? "Error";
      if (msg.includes("OUT_OF_CREDITS")) {
        toast.error("Not enough credits — videos cost 15");
        navigate({ to: "/credits" });
      } else if (msg.includes("BLOCKED_CONTENT")) {
        toast.error("She can't make that kind of video — no credits used.");
      } else toast.error(msg);
    }
  }

  const total = (balance?.free_messages_remaining ?? 0) + (balance?.paid_credits ?? 0);
  const level = (conv as any)?.relationship_level ?? 1;
  const xp = (conv as any)?.relationship_xp ?? 0;
  const xpInLevel = xp % 15;
  const hasPendingJobs = (pendingJobs?.length ?? 0) > 0;
  const isBusy = !!mediaBusy || sending || hasPendingJobs || localJobs.length > 0;
  const showOpener = scenario && messages && messages.length === 0;

  return (
    <div className="flex h-dvh">
      {/* Persistent model live video loop (candy.ai-style) — desktop */}
      <aside className="relative hidden w-80 shrink-0 overflow-hidden bg-neutral-950 md:block lg:w-96">
        {/* Ambient background glow */}
        {p?.companions?.image_url && (
          <img
            src={companionImage(p.companions.image_url)}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full object-cover blur-2xl opacity-30 scale-110"
          />
        )}
        {/* Model video loop with automatic fallback to high-res portrait */}
        {(() => {
          const reelUrl = getEffectiveCompanionReel({
            id: p?.companion_id,
            name: p?.companions?.name,
            gender: (p?.companions as any)?.gender,
          });
          return reelUrl ? (
            <video
              key={p.companion_id}
              src={reelUrl}
              autoPlay
              loop
              muted
              playsInline
              poster={p?.companions?.image_url ? companionImage(p.companions.image_url) : undefined}
              className="relative z-[1] h-full w-full object-contain object-top animate-live"
            />
          ) : p?.companions?.image_url ? (
            <img
              src={companionImage(p.companions.image_url)}
              alt={p?.nickname ?? ""}
              className="relative z-[1] h-full w-full object-contain object-top animate-live"
            />
          ) : null;
        })()}
        <div className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-t from-black/95 via-black/25 to-black/30" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] p-6">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              <Circle className="h-1.5 w-1.5 fill-white text-white" /> Live
            </span>
          </div>
          <div className="mt-1.5 font-display text-3xl font-semibold text-white drop-shadow">
            {p?.nickname ?? "…"}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/90">
            {isBusy ? (
              <span className="inline-flex items-center gap-1 text-primary font-medium">
                <Sparkles className="h-3 w-3 animate-spin text-primary" /> typing a message…
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" /> smiling at you 💋
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-white/70">
              <Heart className="h-3 w-3 fill-primary text-primary" /> Level {level}
            </span>
          </div>
        </div>
      </aside>

      {/* Chat column */}
      <div className="flex h-dvh flex-1 flex-col min-w-0">
        <header className="glass flex items-center gap-3 px-4 py-3">
          <Button asChild size="icon" variant="ghost" className="rounded-full">
            <Link to="/me">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          {p?.companions?.image_url && (
            <img
              src={companionImage(p.companions.image_url)}
              alt=""
              width={52}
              height={52}
              className="h-11 w-11 shrink-0 rounded-full object-cover object-top ring-2 ring-primary/80 shadow-md md:hidden"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="truncate font-display text-lg font-semibold">{p?.nickname ?? "…"}</div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" /> online
              <span className="inline-flex items-center gap-1">
                <Heart className="h-3 w-3 fill-primary text-primary" /> Lv {level}
              </span>
            </div>
          </div>
          {p?.companion_id && (
            <Button
              asChild
              size="icon"
              variant="ghost"
              className="rounded-full"
              title="Edit personality"
            >
              <Link to="/companion/$id" params={{ id: p.companion_id }} search={{ edit: true }}>
                <Sparkles className="h-4 w-4 text-primary" />
              </Link>
            </Button>
          )}
          <Link
            to="/credits"
            className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium ring-1 ring-white/10"
          >
            <Coins className="h-3.5 w-3.5 text-primary" /> {total}
          </Link>
        </header>

        {/* Mobile Live Face & Reaction Stage (Candy.ai style) */}
        <div className="relative mx-3 mt-2 overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 shadow-md md:hidden shrink-0">
          <div className="relative h-56 sm:h-64 w-full overflow-hidden">
            {p?.companions?.image_url && (
              <img
                src={companionImage(p.companions.image_url)}
                alt=""
                className="pointer-events-none absolute inset-0 h-full w-full object-cover blur-xl opacity-40 scale-110"
              />
            )}
            {(() => {
              const reelUrl = getEffectiveCompanionReel({
                id: p?.companion_id,
                name: p?.companions?.name,
                gender: (p?.companions as any)?.gender,
              });
              return reelUrl ? (
                <video
                  key={p.companion_id}
                  src={reelUrl}
                  autoPlay
                  loop
                  muted
                  playsInline
                  poster={p?.companions?.image_url ? companionImage(p.companions.image_url) : undefined}
                  className="relative z-[1] mx-auto h-full w-full object-contain object-top animate-live"
                />
              ) : p?.companions?.image_url ? (
                <img
                  src={companionImage(p.companions.image_url)}
                  alt={p?.nickname ?? ""}
                  className="relative z-[1] mx-auto h-full w-full object-contain object-top animate-live"
                />
              ) : null;
            })()}
            <div className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-t from-black/95 via-transparent to-black/25" />
            <div className="absolute inset-x-0 bottom-2 z-[3] px-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-white font-medium bg-black/65 px-3 py-1 rounded-full backdrop-blur border border-white/15 shadow-sm">
                {isBusy ? (
                  <span className="text-primary flex items-center gap-1">
                    <Sparkles className="h-3 w-3 animate-spin" /> Typing a message…
                  </span>
                ) : (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" /> Smiling at you 💋
                  </span>
                )}
              </div>
              <span className="text-[10px] text-white/80 font-medium bg-black/50 px-2.5 py-1 rounded-full backdrop-blur border border-white/10">
                <Circle className="inline h-1.5 w-1.5 fill-red-500 text-red-500 mr-1" /> Live
              </span>
            </div>
          </div>
        </div>

        <div className="h-1 w-full bg-white/5 mt-2">
          <div
            className="h-full bg-grad-primary transition-all"
            style={{ width: `${(xpInLevel / 15) * 100}%` }}
          />
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-2xl space-y-3">
            {showOpener && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-2xl rounded-bl-md border border-white/10 bg-white/5 px-4 py-2.5 text-sm">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-primary">
                    {scenario!.emoji} {scenario!.title}
                  </div>
                  {scenario!.opener}
                </div>
              </div>
            )}
            {allMessages.length === 0 && !scenario && (
              <div className="glass rounded-2xl p-4 text-center text-sm text-muted-foreground">
                Say hi to {p?.nickname ?? "them"} 💋
              </div>
            )}
            {allMessages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] overflow-hidden rounded-2xl text-sm ${
                    m.role === "user"
                      ? "bg-grad-primary text-primary-foreground rounded-br-md shadow-glow"
                      : "border border-white/10 bg-white/5 rounded-bl-md"
                  }`}
                >
                  {m.kind === "image" && m.media_url && (
                    <img
                      src={m.media_url}
                      alt=""
                      onClick={() => setActiveImageUrl(m.media_url ?? null)}
                      className="block aspect-square w-72 cursor-pointer object-cover transition-opacity hover:opacity-90"
                    />
                  )}
                  {m.kind === "video" && m.media_url && (
                    <video
                      controls
                      playsInline
                      src={m.media_url}
                      className="block w-72 rounded-2xl"
                    />
                  )}
                  {m.kind === "voice" && m.media_url && (
                    <div className="p-2">
                      <audio controls src={m.media_url} className="w-64" />
                    </div>
                  )}
                  {m.kind === "image_pending" && (
                    <div className="relative flex aspect-square w-72 flex-col items-center justify-center bg-black/40 p-4">
                      <div className="absolute inset-0 bg-gradient-to-tr from-primary/10 via-transparent to-primary/5 animate-pulse" />
                      <div className="flex flex-col items-center gap-3 text-center">
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10">
                          <ImageIcon className="h-6 w-6 text-primary animate-pulse" />
                          <div className="absolute inset-0 rounded-full border border-primary/30 border-t-primary animate-spin" />
                        </div>
                        <div className="space-y-1">
                          <div className="font-semibold text-white/90">Generating Photo...</div>
                          <div className="text-xs text-muted-foreground">
                            {Math.max(0, Math.round((Date.now() - new Date((m as any).created_at).getTime()) / 1000))}s elapsed
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {m.kind === "video_pending" && (
                    <div className="relative flex aspect-square w-72 flex-col items-center justify-center bg-black/40 p-4 md:aspect-[9/16]">
                      <div className="absolute inset-0 bg-gradient-to-tr from-primary/10 via-transparent to-primary/5 animate-pulse" />
                      <div className="flex flex-col items-center gap-3 text-center">
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10">
                          <VideoIcon className="h-6 w-6 text-primary animate-pulse" />
                          <div className="absolute inset-0 rounded-full border border-primary/30 border-t-primary animate-spin" />
                        </div>
                        <div className="space-y-1">
                          <div className="font-semibold text-white/90">Generating Video...</div>
                          <div className="text-xs text-muted-foreground">
                            {Math.max(0, Math.round((Date.now() - new Date((m as any).created_at).getTime()) / 1000))}s elapsed
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {m.kind === "voice_pending" && (
                    <div className="relative flex w-64 flex-col items-center justify-center bg-black/40 p-4">
                      <div className="absolute inset-0 bg-gradient-to-tr from-primary/10 via-transparent to-primary/5 animate-pulse" />
                      <div className="flex items-center gap-3">
                        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10">
                          <Mic className="h-4 w-4 text-primary animate-pulse" />
                          <div className="absolute inset-0 rounded-full border border-primary/30 border-t-primary animate-spin" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="font-semibold text-sm text-white/90">Recording Audio...</div>
                          <div className="text-[11px] text-muted-foreground">
                            {Math.max(0, Math.round((Date.now() - new Date((m as any).created_at).getTime()) / 1000))}s elapsed
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {(m.content || m.kind === "text") && (
                    <div className="whitespace-pre-wrap px-4 py-2.5">{m.content}</div>
                  )}
                </div>
              </div>
            ))}
            {pendingUser && (
              <div className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-md bg-grad-primary px-4 py-2.5 text-sm text-primary-foreground shadow-glow">
                  {pendingUser}
                </div>
              </div>
            )}
            {(sending || mediaBusy) && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-white/10 bg-white/5 px-4 py-3 text-sm text-muted-foreground">
                  {mediaBusy === "selfie" ? (
                    `taking a pic for you… ${waited}s`
                  ) : mediaBusy === "voice" ? (
                    "recording…"
                  ) : mediaBusy === "video" ? (
                    `filming a video for you… ${waited}s`
                  ) : (
                    <>
                      <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60" />
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* pb-[env(safe-area-inset-bottom)] keeps the composer clear of the iPhone
            home indicator, which otherwise sits on top of the buttons. */}
        <form
          onSubmit={handleSend}
          className="glass px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <div className="mx-auto flex max-w-2xl items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => !isBusy && setAsking("photo")}
              disabled={isBusy}
              className="rounded-full"
              title="Ask for a selfie (8 credits)"
            >
              <ImageIcon className="h-5 w-5 text-primary" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={handleVoice}
              disabled={isBusy}
              className="rounded-full"
              title="Get her voice note of last reply (3 credits)"
            >
              <Mic className="h-5 w-5 text-primary" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => !isBusy && setAsking("video")}
              disabled={isBusy}
              className="rounded-full"
              title="Ask her for a video (15 credits)"
            >
              <VideoIcon className="h-5 w-5 text-primary" />
            </Button>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Message ${p?.nickname ?? ""}…`}
              disabled={sending}
              className="rounded-full border-white/10 bg-white/5"
            />
            <Button
              type="submit"
              size="icon"
              className="rounded-full bg-grad-primary text-primary-foreground shadow-glow"
              disabled={sending || !input.trim()}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <div className="mx-auto mt-1.5 flex max-w-2xl items-center justify-center gap-3 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-primary" />
              Selfie 8 · Voice 3 · Video 15 · Text 1 credit
            </span>
          </div>
        </form>
      </div>

      {asking && (
        <MediaRequestModal
          kind={asking}
          name={p?.nickname ?? "her"}
          cost={asking === "photo" ? 8 : 15}
          onClose={() => setAsking(null)}
          onSubmit={(prompt, seconds) =>
            asking === "photo" ? runSelfie(prompt) : runVideo(prompt, seconds)
          }
        />
      )}

      {activeImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 transition-all animate-in fade-in duration-200"
          onClick={() => setActiveImageUrl(null)}
        >
          <button
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
            onClick={() => setActiveImageUrl(null)}
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
          <img
            src={activeImageUrl}
            alt="Full Screen Preview"
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
