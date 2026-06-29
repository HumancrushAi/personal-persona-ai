import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { generateCharacter } from "@/lib/characters.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Heart, Sparkles, Wand2, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/create")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Create your AI — HumanCrush.ai" },
      { name: "description", content: "Design your own AI crush — pick gender, art style, ethnicity, body, hair, eyes and vibe. Realistic or anime." },
      { property: "og:title", content: "Create your AI · HumanCrush.ai" },
      { property: "og:description", content: "Build your dream AI companion in under a minute." },
    ],
  }),
  component: CreatePage,
});

type Gender = "female" | "male" | "trans-female" | "trans-male" | "non-binary";
type Style = "realistic" | "anime";

const GENDERS: { id: Gender; label: string; emoji: string }[] = [
  { id: "female", label: "Female", emoji: "♀" },
  { id: "male", label: "Male", emoji: "♂" },
  { id: "trans-female", label: "Trans woman", emoji: "⚧" },
  { id: "trans-male", label: "Trans man", emoji: "⚧" },
  { id: "non-binary", label: "Non-binary", emoji: "✦" },
];

const STYLES: { id: Style; label: string; sub: string }[] = [
  { id: "realistic", label: "Realistic", sub: "Photographic, magazine-quality" },
  { id: "anime", label: "Anime", sub: "Stylized, expressive, manga-inspired" },
];

const ETHNICITIES = [
  "Latina", "East Asian", "Korean", "Japanese", "Indian", "Persian",
  "Black", "African American", "Caribbean", "White European",
  "Italian", "French", "Russian", "Brazilian", "Filipina",
  "Middle Eastern", "Mixed",
];

const BODIES = ["Slim", "Athletic", "Curvy", "Petite", "Tall", "Thick", "Muscular"];
const HAIRS = ["Long black", "Long blonde", "Long brunette", "Short pixie", "Bob cut", "Wavy red", "Pink dyed", "Curly afro", "Silver"];
const EYES = ["Brown", "Hazel", "Green", "Blue", "Grey", "Amber"];
const OUTFITS = ["Crop top + jeans", "Black dress", "White bikini", "Workout set", "Oversized hoodie", "Lace lingerie", "Silk slip", "Streetwear"];
const VIBES = ["Sweet & shy", "Confident & flirty", "Dominant", "Submissive", "Playful brat", "Romantic", "Mysterious", "Goth", "Girl next door"];

function CreatePage() {
  const navigate = useNavigate();
  const generate = useServerFn(generateCharacter);

  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender>("female");
  const [artStyle, setArtStyle] = useState<Style>("realistic");
  const [ethnicity, setEthnicity] = useState(ETHNICITIES[0]);
  const [age, setAge] = useState(22);
  const [body, setBody] = useState(BODIES[1]);
  const [hair, setHair] = useState(HAIRS[0]);
  const [eyes, setEyes] = useState(EYES[0]);
  const [outfit, setOutfit] = useState(OUTFITS[0]);
  const [vibe, setVibe] = useState(VIBES[1]);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!name.trim()) {
      toast("Give them a name first ✨");
      return;
    }
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      navigate({ to: "/auth" });
      return;
    }
    setLoading(true);
    try {
      const { id } = await generate({
        data: { name: name.trim(), gender, artStyle, ethnicity, age, bodyType: body, hair, eyes, outfit, vibe },
      });
      toast("She's ready 💋");
      navigate({ to: "/companion/$id", params: { id } });
    } catch (e: any) {
      toast(`Generation failed: ${e.message ?? "try again"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen pb-24">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 md:px-6">
        <Link to="/" className="flex items-center gap-2">
          <Heart className="h-6 w-6 fill-primary text-primary" />
          <span className="font-display text-xl font-semibold tracking-tight md:text-2xl">HumanCrush.ai</span>
        </Link>
        <Button asChild variant="ghost" className="rounded-full text-sm">
          <Link to="/gallery"><ArrowLeft className="mr-1.5 h-4 w-4" /> Gallery</Link>
        </Button>
      </header>

      <section className="mx-auto max-w-5xl px-4 md:px-6">
        <div className="glass rounded-3xl p-5 md:p-8">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Create your AI · 1 portrait credit
          </p>
          <h1 className="mt-3 font-display text-3xl font-semibold md:text-5xl">
            Build your <span className="bg-grad-primary bg-clip-text text-transparent">crush</span>.
          </h1>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground md:text-base">
            Pick the look. We generate her, then you fine-tune her personality.
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-[1fr_1fr]">
          {/* LEFT — basics */}
          <div className="space-y-5 rounded-3xl border border-white/10 bg-card p-5">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aria" maxLength={40} />
            </Field>

            <Field label="Art style">
              <div className="grid grid-cols-2 gap-2">
                {STYLES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setArtStyle(s.id)}
                    className={`rounded-2xl border p-3 text-left transition ${
                      artStyle === s.id
                        ? "border-primary bg-grad-primary/15 shadow-glow"
                        : "border-white/10 bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    <p className="font-display text-sm font-semibold">{s.label}</p>
                    <p className="text-[11px] text-muted-foreground">{s.sub}</p>
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Gender">
              <ChipRow options={GENDERS.map((g) => ({ id: g.id, label: `${g.emoji} ${g.label}` }))}
                value={gender} onChange={(v) => setGender(v as Gender)} />
            </Field>

            <Field label={`Age · ${age}`}>
              <input
                type="range" min={18} max={45} value={age}
                onChange={(e) => setAge(Number(e.target.value))}
                className="w-full accent-[hsl(var(--primary))]"
              />
            </Field>

            <Field label="Ethnicity">
              <ChipRow options={ETHNICITIES.map((e) => ({ id: e, label: e }))} value={ethnicity} onChange={setEthnicity} />
            </Field>
          </div>

          {/* RIGHT — appearance + vibe */}
          <div className="space-y-5 rounded-3xl border border-white/10 bg-card p-5">
            <Field label="Body">
              <ChipRow options={BODIES.map((e) => ({ id: e, label: e }))} value={body} onChange={setBody} />
            </Field>
            <Field label="Hair">
              <ChipRow options={HAIRS.map((e) => ({ id: e, label: e }))} value={hair} onChange={setHair} />
            </Field>
            <Field label="Eyes">
              <ChipRow options={EYES.map((e) => ({ id: e, label: e }))} value={eyes} onChange={setEyes} />
            </Field>
            <Field label="Outfit">
              <ChipRow options={OUTFITS.map((e) => ({ id: e, label: e }))} value={outfit} onChange={setOutfit} />
            </Field>
            <Field label="Vibe">
              <ChipRow options={VIBES.map((e) => ({ id: e, label: e }))} value={vibe} onChange={setVibe} />
            </Field>
          </div>
        </div>

        <div className="sticky bottom-3 mt-6 flex justify-center">
          <Button
            size="lg"
            onClick={submit}
            disabled={loading}
            className="rounded-full bg-grad-primary px-8 text-primary-foreground shadow-glow"
          >
            {loading ? (
              <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Generating your crush…</>
            ) : (
              <><Wand2 className="mr-2 h-5 w-5" /> Generate AI character</>
            )}
          </Button>
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-white/70">{label}</p>
      {children}
    </div>
  );
}

function ChipRow({
  options, value, onChange,
}: { options: { id: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
            value === o.id
              ? "border-primary/60 bg-grad-primary text-primary-foreground shadow-glow"
              : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
