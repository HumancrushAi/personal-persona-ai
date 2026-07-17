import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { companionImage } from "@/lib/companion-images";
import { sendChatMessage } from "@/lib/chat.functions";
import { generateSelfie, generateVoiceNote } from "@/lib/media.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Send, Coins, Image as ImageIcon, Mic, Heart, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { getScenario } from "@/lib/scenarios";

export const Route = createFileRoute("/chat/$conversationId")({
  ssr: false,
  head: () => ({ meta: [{ title: "Chat — HumanCrush.ai" }] }),
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
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState<"selfie" | "voice" | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;
    const total = (balance?.free_messages_remaining ?? 0) + (balance?.paid_credits ?? 0);
    if (total <= 0) {
      toast.error("You're out of credits");
      navigate({ to: "/credits" });
      return;
    }
    setSending(true);
    const content = input.trim();
    setInput("");
    setPendingUser(content); // show my message instantly
    const start = Date.now();
    try {
      const res = await send({ data: { conversationId, content } });

      // Human-feeling typing pause: aim for a total "typing" time based on how
      // long the reply is, but don't add time the AI call already used up.
      const target = Math.min(1200 + (res?.reply?.length ?? 0) * 28, 7000);
      const elapsed = Date.now() - start;
      if (elapsed < target) await new Promise((r) => setTimeout(r, target - elapsed));

      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["conv-meta", conversationId] });
      await qc.invalidateQueries({ queryKey: ["messages", conversationId] });
      setPendingUser(null); // real messages are loaded now — drop the optimistic bubble
      if (res?.relationship?.leveledUp) {
        toast.success(`💖 Relationship level up — now level ${res.relationship.level}`);
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

  async function handleSelfie() {
    if (mediaBusy) return;
    const prompt =
      window.prompt(`What should ${p?.nickname ?? "she"} send a pic of? (optional)`, "") ??
      undefined;
    setMediaBusy("selfie");
    try {
      await selfie({ data: { conversationId, prompt } });
      qc.invalidateQueries({ queryKey: ["messages", conversationId] });
      qc.invalidateQueries({ queryKey: ["balance"] });
    } catch (err: any) {
      const msg = err?.message ?? "Error";
      if (msg.includes("OUT_OF_CREDITS")) {
        toast.error("Not enough credits — selfies cost 8");
        navigate({ to: "/credits" });
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

  const total = (balance?.free_messages_remaining ?? 0) + (balance?.paid_credits ?? 0);
  const level = (conv as any)?.relationship_level ?? 1;
  const xp = (conv as any)?.relationship_xp ?? 0;
  const xpInLevel = xp % 15;
  const showOpener = scenario && messages && messages.length === 0;

  return (
    <div className="flex h-screen flex-col">
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
            className="h-10 w-10 rounded-full object-cover ring-2 ring-primary/60"
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
              Say hi to {p?.nickname ?? "her"} 💋
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
                  <img src={m.media_url} alt="" className="block aspect-square w-72 object-cover" />
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
                  "taking a pic for you…"
                ) : mediaBusy === "voice" ? (
                  "recording…"
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

      <form onSubmit={handleSend} className="glass px-3 py-3">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={handleSelfie}
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
            Selfie 8 · Voice 3 · Text 1 credit
          </span>
        </div>
      </form>
    </div>
  );
}
