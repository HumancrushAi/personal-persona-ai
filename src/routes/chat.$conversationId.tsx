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
} from "lucide-react";
import { toast } from "sonner";
import { getScenario } from "@/lib/scenarios";

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
  }, [messages, sending, mediaBusy, pendingUser]);

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
    while (attempts < maxAttempts) {
      let res: any;
      try {
        res = await checkJob({ data: { jobId } });
      } catch {
        res = null; // transient — keep polling
      }
      if (res?.status === "completed") {
        await qc.invalidateQueries({ queryKey: ["messages", conversationId] });
        await qc.invalidateQueries({ queryKey: ["balance"] });
        toast.success(label === "video" ? "Video received!" : "Photo received!");
        return;
      }
      if (res?.status === "failed") {
        throw new Error("Generation failed");
      }
      await new Promise((r) => setTimeout(r, 2000));
      attempts++;
    }
    // Now literally true: the messages query polls, so whenever the server
    // finishes it the media drops into the conversation on its own.
    toast.info(`She is still working on that ${label}. It'll appear here as soon as it's ready.`);
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
    try {
      const res = await selfie({ data: { conversationId, prompt } });
      await pollMediaJob((res as any).jobId, "photo");
    } catch (err: any) {
      const msg = err?.message ?? "Error";
      if (msg.includes("OUT_OF_CREDITS")) {
        toast.error("Not enough credits — selfies cost 8");
        navigate({ to: "/credits" });
      } else if (msg.includes("BLOCKED_CONTENT")) {
        toast.error("She can't take that kind of pic — no credits used.");
      } else toast.error(msg);
    } finally {
      setMediaBusy(null);
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
    try {
      // Send the duration itself. This used to send a `settings` object that
      // the server no longer accepted, so zod stripped it and every clip came
      // back at the 5s default no matter what was picked.
      const res = await requestVideoFn({ data: { conversationId, prompt, seconds } });
      await pollMediaJob((res as any).jobId, "video");
    } catch (err: any) {
      const msg = err?.message ?? "Error";
      if (msg.includes("OUT_OF_CREDITS")) {
        toast.error("Not enough credits — videos cost 15");
        navigate({ to: "/credits" });
      } else if (msg.includes("BLOCKED_CONTENT")) {
        toast.error("She can't make that kind of video — no credits used.");
      } else toast.error(msg);
    } finally {
      setMediaBusy(null);
    }
  }

  const total = (balance?.free_messages_remaining ?? 0) + (balance?.paid_credits ?? 0);
  const level = (conv as any)?.relationship_level ?? 1;
  const xp = (conv as any)?.relationship_xp ?? 0;
  const xpInLevel = xp % 15;
  const showOpener = scenario && messages && messages.length === 0;

  return (
    <div className="flex h-dvh">
      {/* Persistent model image (candy.ai-style) — desktop */}
      <aside className="relative hidden w-80 shrink-0 md:block lg:w-96">
        {p?.companions?.image_url && (
          <img
            src={companionImage(p.companions.image_url)}
            alt={p?.nickname ?? ""}
            className="h-full w-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/30" />
        <div className="absolute inset-x-0 bottom-0 p-6">
          <div className="font-display text-3xl font-semibold text-white drop-shadow">
            {p?.nickname ?? "…"}
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-xs text-white/85">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" /> online now
            <span className="inline-flex items-center gap-1">
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
              width={48}
              height={48}
              className="h-10 w-10 rounded-full object-cover ring-2 ring-primary/60 md:hidden"
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
              title="Edit her personality"
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

        <div className="h-1 w-full bg-white/5">
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
            {messages?.length === 0 && !scenario && (
              <div className="glass rounded-2xl p-4 text-center text-sm text-muted-foreground">
                Say hi to {p?.nickname ?? "them"} 💋
              </div>
            )}
            {messages?.map((m) => (
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
              onClick={() => !mediaBusy && setAsking("photo")}
              disabled={!!mediaBusy || sending}
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
              disabled={!!mediaBusy || sending}
              className="rounded-full"
              title="Get her voice note of last reply (3 credits)"
            >
              <Mic className="h-5 w-5 text-primary" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => !mediaBusy && setAsking("video")}
              disabled={!!mediaBusy || sending}
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
