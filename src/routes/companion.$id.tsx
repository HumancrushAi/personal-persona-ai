import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { companionImage } from "@/lib/companion-images";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Heart, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/companion/$id")({
  ssr: false,
  head: () => ({ meta: [{ title: "Customize — Aurelia" }] }),
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  const navigate = useNavigate();

  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setAuthed(!!data.user));
  }, []);

  const { data: companion } = useQuery({
    queryKey: ["companion", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("companions")
        .select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [nickname, setNickname] = useState("");
  const [identity, setIdentity] = useState("");
  const [traits, setTraits] = useState("");
  const [interests, setInterests] = useState("");
  const [backstory, setBackstory] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (companion && !nickname) setNickname(companion.name);
  }, [companion]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!authed) { navigate({ to: "/auth" }); return; }
    setSaving(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      const { data: personality, error } = await supabase
        .from("user_personalities")
        .insert({
          user_id: user.user!.id,
          companion_id: id,
          nickname: nickname || companion!.name,
          identity, personality_traits: traits, interests, style_backstory: backstory,
        })
        .select("id").single();
      if (error) throw error;

      const { data: conv, error: cErr } = await supabase
        .from("conversations")
        .insert({ user_id: user.user!.id, personality_id: personality.id, title: `Chat with ${nickname}` })
        .select("id").single();
      if (cErr) throw cErr;

      navigate({ to: "/chat/$conversationId", params: { conversationId: conv.id } });
    } catch (err: any) {
      toast.error(err.message ?? "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  if (!companion) return <div className="p-10 text-muted-foreground">Loading…</div>;

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Button asChild variant="ghost" className="rounded-full">
          <Link to="/browse"><ArrowLeft className="mr-1 h-4 w-4" /> Back</Link>
        </Button>
        <Link to="/" className="flex items-center gap-2">
          <Heart className="h-5 w-5 fill-primary text-primary" />
          <span className="font-display text-xl font-semibold">Aurelia</span>
        </Link>
      </header>

      <div className="mx-auto grid max-w-5xl gap-8 px-6 pb-16 md:grid-cols-[1fr_1.3fr]">
        <div className="md:sticky md:top-6 md:self-start">
          <img
            src={companionImage(companion.image_url)}
            alt={companion.name}
            width={1024} height={1024}
            className="aspect-[3/4] w-full rounded-3xl object-cover shadow-lg"
          />
          <h1 className="mt-4 font-display text-3xl font-semibold">{companion.name}, {companion.age}</h1>
          <p className="text-sm text-muted-foreground">{companion.ethnicity}</p>
          <p className="mt-2 text-sm">{companion.short_bio}</p>
          <p className="mt-3 text-xs italic text-muted-foreground">Base: {companion.base_personality}</p>
        </div>

        <form onSubmit={handleCreate} className="space-y-6 rounded-3xl border bg-card p-6 shadow-sm">
          <div>
            <h2 className="font-display text-2xl font-semibold">Make her yours</h2>
            <p className="text-sm text-muted-foreground">Shape her personality. All fields optional except a name.</p>
          </div>

          <div>
            <Label>Nickname</Label>
            <Input value={nickname} onChange={e => setNickname(e.target.value)} placeholder={companion.name} required />
          </div>
          <div>
            <Label>Identity</Label>
            <Textarea rows={3} value={identity} onChange={e => setIdentity(e.target.value)}
              placeholder="Who is she? Her age, where she lives, her name for you, how she sees herself." />
          </div>
          <div>
            <Label>Personality traits</Label>
            <Textarea rows={3} value={traits} onChange={e => setTraits(e.target.value)}
              placeholder="Playful, sarcastic, deeply caring, romantic, adventurous…" />
          </div>
          <div>
            <Label>Interests</Label>
            <Textarea rows={3} value={interests} onChange={e => setInterests(e.target.value)}
              placeholder="Indie music, vintage films, baking, late-night philosophy, hiking…" />
          </div>
          <div>
            <Label>Style &amp; backstory</Label>
            <Textarea rows={4} value={backstory} onChange={e => setBackstory(e.target.value)}
              placeholder="How she talks (texting style, pet names, slang), and the story of how you two met." />
          </div>
          <Button type="submit" className="w-full rounded-full" size="lg" disabled={saving}>
            {saving ? "Starting…" : authed ? "Start chatting" : "Sign in to start"}
          </Button>
        </form>
      </div>
    </div>
  );
}
