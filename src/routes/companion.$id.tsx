import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { companionImage } from "@/lib/companion-images";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Heart, ArrowLeft, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { SCENARIOS } from "@/lib/scenarios";

const searchSchema = z.object({
  edit: z.coerce.boolean().optional(),
  personalityId: z.string().uuid().optional(),
});

export const Route = createFileRoute("/companion/$id")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => searchSchema.parse(s),
  head: () => ({ meta: [{ title: "Customize — HumanCrush.ai" }] }),
  component: Page,
});

const TONE_PRESETS = [
  "Flirty & teasing",
  "Soft & affectionate",
  "Confident & dominant",
  "Submissive & eager",
  "Playful & bratty",
  "Sultry & slow",
  "Sweet & innocent",
  "Filthy & explicit",
  "Sarcastic & witty",
];

const BOUNDARY_PRESETS = [
  "No degrading language",
  "No pain / rough kink",
  "No pet names",
  "No jealousy / possessive talk",
  "Keep it SFW",
  "No mentions of exes",
  "No drug references",
  "No emojis",
];

const INTEREST_PRESETS = [
  "Late-night philosophy",
  "Gaming",
  "Indie music",
  "Cooking",
  "Travel",
  "Working out",
  "Anime",
  "Fashion",
  "Books",
  "True crime",
  "Yoga",
  "Photography",
  "Dancing",
  "Tattoos",
];

function ChipPicker({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o);
        return (
          <button
            type="button"
            key={o}
            onClick={() => onToggle(o)}
            className={`rounded-full border px-3 py-1.5 text-xs transition ${
              on
                ? "border-primary bg-primary/15 text-primary shadow-glow"
                : "border-white/10 bg-white/5 text-muted-foreground hover:border-primary/40"
            }`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function toList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}
function fromList(arr: string[]): string {
  return arr.join(", ");
}

function Page() {
  const { id } = Route.useParams();
  const { edit, personalityId } = Route.useSearch();
  const navigate = useNavigate();

  // Login-first: bounce anonymous visitors to /auth before they can view/customize.
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) navigate({ to: "/auth" });
      else setAuthed(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: companion } = useQuery({
    queryKey: ["companion", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companions")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Load existing personality (edit mode)
  const { data: existing } = useQuery({
    enabled: !!authed && (edit || !!personalityId),
    queryKey: ["my-personality", id, personalityId ?? "latest"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      let q = supabase
        .from("user_personalities")
        .select("*")
        .eq("user_id", u.user.id)
        .eq("companion_id", id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (personalityId) {
        q = supabase.from("user_personalities").select("*").eq("id", personalityId).limit(1);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
  const isEditing = !!existing;

  const [nickname, setNickname] = useState("");
  const [identity, setIdentity] = useState("");
  const [traits, setTraits] = useState("");
  const [toneText, setToneText] = useState("");
  const [boundariesText, setBoundariesText] = useState("");
  const [interestsText, setInterestsText] = useState("");
  const [backstory, setBackstory] = useState("");
  const [scenario, setScenario] = useState<string>("open");
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate once from companion or existing personality
  useEffect(() => {
    if (hydrated) return;
    if (existing) {
      setNickname(existing.nickname ?? "");
      setIdentity(existing.identity ?? "");
      setTraits(existing.personality_traits ?? "");
      setToneText((existing as any).tone ?? "");
      setBoundariesText((existing as any).boundaries ?? "");
      setInterestsText(existing.interests ?? "");
      setBackstory(existing.style_backstory ?? "");
      setHydrated(true);
    } else if (companion && !edit && !personalityId) {
      setNickname(companion.name);
      setHydrated(true);
    }
  }, [existing, companion, edit, personalityId, hydrated]);

  const toneList = useMemo(() => toList(toneText), [toneText]);
  const boundaryList = useMemo(() => toList(boundariesText), [boundariesText]);
  const interestList = useMemo(() => toList(interestsText), [interestsText]);

  function toggleIn(list: string[], setter: (s: string) => void, value: string) {
    const next = list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
    setter(fromList(next));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!authed) {
      navigate({ to: "/auth" });
      return;
    }
    setSaving(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      const payload = {
        nickname: nickname || companion!.name,
        identity,
        personality_traits: traits,
        tone: toneText,
        boundaries: boundariesText,
        interests: interestsText,
        style_backstory: backstory,
      };

      if (isEditing) {
        const { error } = await supabase
          .from("user_personalities")
          .update(payload)
          .eq("id", existing!.id);
        if (error) throw error;
        toast.success("Personality updated");

        // Return to most recent conversation if exists, else create one
        const { data: convs } = await supabase
          .from("conversations")
          .select("id")
          .eq("user_id", user.user!.id)
          .eq("personality_id", existing!.id)
          .order("updated_at", { ascending: false })
          .limit(1);
        if (convs?.[0]) {
          navigate({ to: "/chat/$conversationId", params: { conversationId: convs[0].id } });
          return;
        }
      }

      let personalityRowId = existing?.id;
      if (!isEditing) {
        const { data: personality, error } = await supabase
          .from("user_personalities")
          .insert({ user_id: user.user!.id, companion_id: id, ...payload })
          .select("id")
          .single();
        if (error) throw error;
        personalityRowId = personality.id;
      }

      const { data: conv, error: cErr } = await supabase
        .from("conversations")
        .insert({
          user_id: user.user!.id,
          personality_id: personalityRowId!,
          title: `Chat with ${nickname}`,
          scenario: scenario === "open" ? null : scenario,
        })
        .select("id")
        .single();
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
          <Link to="/browse">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Link>
        </Button>
        <Link to="/" className="flex items-center gap-2">
          <Heart className="h-5 w-5 fill-primary text-primary" />
          <span className="font-display text-xl font-semibold">HumanCrush.ai</span>
        </Link>
      </header>

      <div className="mx-auto grid max-w-5xl gap-8 px-6 pb-16 md:grid-cols-[1fr_1.3fr]">
        <div className="md:sticky md:top-6 md:self-start">
          <img
            src={companionImage(companion.image_url)}
            alt={companion.name}
            width={1024}
            height={1024}
            className="aspect-[3/4] w-full rounded-3xl object-cover shadow-glow ring-1 ring-white/10"
          />
          <h1 className="mt-4 font-display text-3xl font-semibold">
            {companion.name}, {companion.age}
          </h1>
          <p className="text-xs uppercase tracking-wide text-primary">{companion.ethnicity}</p>
          <p className="mt-2 text-sm text-muted-foreground">{companion.short_bio}</p>
          <p className="mt-3 text-xs italic text-muted-foreground">
            Base vibe: {companion.base_personality}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="glass space-y-6 rounded-3xl p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl font-semibold">
                {isEditing ? "Edit her personality" : "Make her yours"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {isEditing
                  ? "Tweak tone, boundaries and interests. Changes apply to your next message."
                  : "Shape her tone, boundaries, and what she's into before you chat."}
              </p>
            </div>
            <Sparkles className="h-5 w-5 text-primary" />
          </div>

          <div>
            <Label>Nickname</Label>
            <Input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={companion.name}
              required
            />
          </div>

          <div>
            <Label>Identity</Label>
            <Textarea
              rows={3}
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
              placeholder="Who is she? Where she lives, what she calls you, how she sees herself."
            />
          </div>

          <div>
            <Label>Personality traits</Label>
            <Textarea
              rows={2}
              value={traits}
              onChange={(e) => setTraits(e.target.value)}
              placeholder="Playful, dominant, deeply affectionate, possessive…"
            />
          </div>

          <div>
            <Label>Tone of voice</Label>
            <p className="text-xs text-muted-foreground">
              How she texts. Tap to add, or write your own.
            </p>
            <ChipPicker
              options={TONE_PRESETS}
              selected={toneList}
              onToggle={(v) => toggleIn(toneList, setToneText, v)}
            />
            <Input
              className="mt-2"
              value={toneText}
              onChange={(e) => setToneText(e.target.value)}
              placeholder="e.g. Flirty & teasing, sultry & slow"
            />
          </div>

          <div>
            <Label>Boundaries</Label>
            <p className="text-xs text-muted-foreground">Hard limits she'll always respect.</p>
            <ChipPicker
              options={BOUNDARY_PRESETS}
              selected={boundaryList}
              onToggle={(v) => toggleIn(boundaryList, setBoundariesText, v)}
            />
            <Input
              className="mt-2"
              value={boundariesText}
              onChange={(e) => setBoundariesText(e.target.value)}
              placeholder="e.g. No degrading language, no pain"
            />
          </div>

          <div>
            <Label>Interests</Label>
            <p className="text-xs text-muted-foreground">Things she loves talking about.</p>
            <ChipPicker
              options={INTEREST_PRESETS}
              selected={interestList}
              onToggle={(v) => toggleIn(interestList, setInterestsText, v)}
            />
            <Input
              className="mt-2"
              value={interestsText}
              onChange={(e) => setInterestsText(e.target.value)}
              placeholder="e.g. Indie music, climbing, cooking"
            />
          </div>

          <div>
            <Label>Style &amp; backstory</Label>
            <Textarea
              rows={3}
              value={backstory}
              onChange={(e) => setBackstory(e.target.value)}
              placeholder="How she texts (pet names, slang) and how the two of you met."
            />
          </div>

          {!isEditing && (
            <div>
              <Label>Pick a starting scene</Label>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {SCENARIOS.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => setScenario(s.id)}
                    className={`rounded-2xl border p-3 text-left text-xs transition ${
                      scenario === s.id
                        ? "border-primary bg-primary/10 shadow-glow"
                        : "border-white/10 bg-white/5 hover:border-primary/40"
                    }`}
                  >
                    <div className="text-base">{s.emoji}</div>
                    <div className="mt-1 font-semibold">{s.title}</div>
                    <div className="mt-0.5 text-muted-foreground line-clamp-2">{s.description}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <Button
            type="submit"
            className="w-full rounded-full bg-grad-primary text-primary-foreground shadow-glow"
            size="lg"
            disabled={saving}
          >
            {saving
              ? "Saving…"
              : !authed
                ? "Sign in to start"
                : isEditing
                  ? "Save & return to chat"
                  : "Start chatting →"}
          </Button>
        </form>
      </div>
    </div>
  );
}
