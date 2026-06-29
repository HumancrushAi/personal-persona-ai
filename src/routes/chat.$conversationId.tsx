import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { companionImage } from "@/lib/companion-images";
import { sendChatMessage } from "@/lib/chat.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Send, Coins } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/chat/$conversationId")({
  ssr: false,
  head: () => ({ meta: [{ title: "Chat — Aurelia" }] }),
  component: ChatPage,
});

function ChatPage() {
  const { conversationId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const send = useServerFn(sendChatMessage);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) navigate({ to: "/auth" });
    });
  }, []);

  const { data: conv } = useQuery({
    queryKey: ["conv-meta", conversationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("conversations")
        .select("id, personality_id, user_personalities(nickname, companions(name, image_url))")
        .eq("id", conversationId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: messages } = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    refetchInterval: 0,
  });

  const { data: balance } = useQuery({
    queryKey: ["balance"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase.from("credit_balances")
        .select("free_messages_remaining, paid_credits")
        .eq("user_id", u.user.id).maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

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
    try {
      await send({ data: { conversationId, content } });
      qc.invalidateQueries({ queryKey: ["messages", conversationId] });
      qc.invalidateQueries({ queryKey: ["balance"] });
    } catch (err: any) {
      const msg = err?.message ?? "Error";
      if (msg.includes("OUT_OF_CREDITS")) {
        toast.error("Out of credits");
        navigate({ to: "/credits" });
      } else {
        toast.error(msg);
      }
      setInput(content);
    } finally {
      setSending(false);
    }
  }

  const p: any = conv?.user_personalities;
  const total = (balance?.free_messages_remaining ?? 0) + (balance?.paid_credits ?? 0);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b bg-card/80 px-4 py-3 backdrop-blur">
        <Button asChild size="icon" variant="ghost" className="rounded-full">
          <Link to="/me"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        {p?.companions?.image_url && (
          <img src={companionImage(p.companions.image_url)} alt=""
            width={48} height={48}
            className="h-10 w-10 rounded-full object-cover" />
        )}
        <div className="flex-1 min-w-0">
          <div className="truncate font-display text-lg font-semibold">{p?.nickname ?? "…"}</div>
          <div className="text-xs text-muted-foreground">Online</div>
        </div>
        <Link to="/credits" className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium">
          <Coins className="h-3.5 w-3.5" /> {total} left
        </Link>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-3">
          {messages?.length === 0 && (
            <div className="rounded-2xl border bg-card p-4 text-center text-sm text-muted-foreground">
              Say hi to {p?.nickname ?? "her"} 💌
            </div>
          )}
          {messages?.map(m => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-md"
                  : "bg-card border rounded-bl-md"
              }`}>
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md border bg-card px-4 py-2.5 text-sm text-muted-foreground">
                typing…
              </div>
            </div>
          )}
        </div>
      </div>

      <form onSubmit={handleSend} className="border-t bg-card/80 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <Input
            value={input} onChange={e => setInput(e.target.value)}
            placeholder={`Message ${p?.nickname ?? ""}…`}
            disabled={sending}
            className="rounded-full"
          />
          <Button type="submit" size="icon" className="rounded-full" disabled={sending || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}
