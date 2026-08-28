import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { generateCharacter } from "@/lib/characters.functions";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, Wand2, Loader2, ArrowLeft, ArrowRight, Check } from "lucide-react";
import { toast } from "sonner";

import bodySlim from "@/assets/create/body-slim.jpg";
import bodyAthletic from "@/assets/create/body-athletic.jpg";
import bodyCurvy from "@/assets/create/body-curvy.jpg";
import bodyPetite from "@/assets/create/body-petite.jpg";
import bodyTall from "@/assets/create/body-tall.jpg";
import bodyThick from "@/assets/create/body-thick.jpg";
import bodyMuscular from "@/assets/create/body-muscular.jpg";
import breastSmall from "@/assets/create/breast-small.jpg";
import breastMedium from "@/assets/create/breast-medium.jpg";
import breastLarge from "@/assets/create/breast-large.jpg";
import breastBusty from "@/assets/create/breast-busty.jpg";
import buttSmall from "@/assets/create/butt-small.jpg";
import buttMedium from "@/assets/create/butt-medium.jpg";
import buttLarge from "@/assets/create/butt-large.jpg";
import buttBig from "@/assets/create/butt-big.jpg";
import hairLongBlack from "@/assets/create/hair-long-black.jpg";
import hairLongBlonde from "@/assets/create/hair-long-blonde.jpg";
import hairLongBrunette from "@/assets/create/hair-long-brunette.jpg";
import hairShortPixie from "@/assets/create/hair-short-pixie.jpg";
import hairBob from "@/assets/create/hair-bob.jpg";
import hairWavyRed from "@/assets/create/hair-wavy-red.jpg";
import hairPink from "@/assets/create/hair-pink.jpg";
import hairCurlyAfro from "@/assets/create/hair-curly-afro.jpg";
import hairSilver from "@/assets/create/hair-silver.jpg";
import eyeBrown from "@/assets/create/eye-brown.jpg";
import eyeHazel from "@/assets/create/eye-hazel.jpg";
import eyeGreen from "@/assets/create/eye-green.jpg";
import eyeBlue from "@/assets/create/eye-blue.jpg";
import eyeGrey from "@/assets/create/eye-grey.jpg";
import eyeAmber from "@/assets/create/eye-amber.jpg";
import outfitCrop from "@/assets/create/outfit-crop.jpg";
import outfitBlack from "@/assets/create/outfit-black-dress.jpg";
import outfitSundress from "@/assets/create/outfit-sundress.jpg";
import outfitWorkout from "@/assets/create/outfit-workout.jpg";
import outfitHoodie from "@/assets/create/outfit-hoodie.jpg";
import outfitSilk from "@/assets/create/outfit-silk.jpg";
import outfitStreet from "@/assets/create/outfit-streetwear.jpg";
import outfitGown from "@/assets/create/outfit-gown.jpg";
import vibeSweet from "@/assets/create/vibe-sweet.jpg";
import vibeFlirty from "@/assets/create/vibe-flirty.jpg";
import vibeDominant from "@/assets/create/vibe-dominant.jpg";
import vibeSubmissive from "@/assets/create/vibe-submissive.jpg";
import vibeBrat from "@/assets/create/vibe-brat.jpg";
import vibeRomantic from "@/assets/create/vibe-romantic.jpg";
import vibeMysterious from "@/assets/create/vibe-mysterious.jpg";
import vibeGoth from "@/assets/create/vibe-goth.jpg";
import imgRealistic from "@/assets/companions/01-aria.jpg";
import imgAnime from "@/assets/companions/anime1.jpg";

export const Route = createFileRoute("/create")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Create your AI — HumanCrush.com" },
      {
        name: "description",
        content:
          "Design your own AI crush — pick gender, art style, ethnicity, body, hair, eyes and vibe. Realistic or anime.",
      },
      { property: "og:title", content: "Create your AI · HumanCrush.com" },
      { property: "og:description", content: "Build your dream AI companion in under a minute." },
    ],
  }),
  component: CreatePage,
});

type Gender = "female" | "male" | "trans-female" | "trans-male" | "non-binary";
type Style = "realistic" | "anime";

// Every option id is fed verbatim into the portrait prompt, so the strings here
// are content, not labels — renaming one changes what gets generated.
type Option = { id: string; label: string; img: string };

const ETHNICITIES = [
  "Latina",
  "East Asian",
  "Korean",
  "Japanese",
  "Indian",
  "Persian",
  "Black",
  "African American",
  "Caribbean",
  "White European",
  "Italian",
  "French",
  "Russian",
  "Brazilian",
  "Filipina",
  "Middle Eastern",
  "Mixed",
];

const BODIES: Option[] = [
  { id: "Slim", label: "Slim", img: bodySlim },
  { id: "Athletic", label: "Athletic", img: bodyAthletic },
  { id: "Curvy", label: "Curvy", img: bodyCurvy },
  { id: "Petite", label: "Petite", img: bodyPetite },
  { id: "Tall", label: "Tall", img: bodyTall },
  { id: "Thick", label: "Thick", img: bodyThick },
  { id: "Muscular", label: "Muscular", img: bodyMuscular },
];

const BREASTS: Option[] = [
  { id: "Small", label: "Small (A)", img: breastSmall },
  { id: "Medium", label: "Medium (B/C)", img: breastMedium },
  { id: "Large", label: "Large (D)", img: breastLarge },
  { id: "Busty", label: "Busty (DD+)", img: breastBusty },
];

// Shot from behind. These used to borrow the front-facing body photos, because
// the image provider refused every rear-view prompt — so the one step that asks
// about her backside illustrated it with her front.
const BUTTS: Option[] = [
  { id: "Small", label: "Small", img: buttSmall },
  { id: "Medium", label: "Athletic", img: buttMedium },
  { id: "Large", label: "Curvy", img: buttLarge },
  { id: "Big", label: "Voluptuous", img: buttBig },
];

const HAIRS: Option[] = [
  { id: "Long black", label: "Long black", img: hairLongBlack },
  { id: "Long blonde", label: "Long blonde", img: hairLongBlonde },
  { id: "Long brunette", label: "Long brunette", img: hairLongBrunette },
  { id: "Short pixie", label: "Short pixie", img: hairShortPixie },
  { id: "Bob cut", label: "Bob cut", img: hairBob },
  { id: "Wavy red", label: "Wavy red", img: hairWavyRed },
  { id: "Pink dyed", label: "Pink dyed", img: hairPink },
  { id: "Curly afro", label: "Curly afro", img: hairCurlyAfro },
  { id: "Silver", label: "Silver", img: hairSilver },
];

const EYES: Option[] = [
  { id: "Brown", label: "Brown", img: eyeBrown },
  { id: "Hazel", label: "Hazel", img: eyeHazel },
  { id: "Green", label: "Green", img: eyeGreen },
  { id: "Blue", label: "Blue", img: eyeBlue },
  { id: "Grey", label: "Grey", img: eyeGrey },
  { id: "Amber", label: "Amber", img: eyeAmber },
];

const OUTFITS: Option[] = [
  { id: "Crop top + jeans", label: "Crop top + jeans", img: outfitCrop },
  { id: "Black dress", label: "Black dress", img: outfitBlack },
  { id: "Sundress", label: "Sundress", img: outfitSundress },
  { id: "Workout set", label: "Workout set", img: outfitWorkout },
  { id: "Oversized hoodie", label: "Oversized hoodie", img: outfitHoodie },
  { id: "Silk blouse", label: "Silk blouse", img: outfitSilk },
  { id: "Streetwear", label: "Streetwear", img: outfitStreet },
  { id: "Evening gown", label: "Evening gown", img: outfitGown },
];

const VIBES: Option[] = [
  { id: "Sweet & shy", label: "Sweet & shy", img: vibeSweet },
  { id: "Confident & flirty", label: "Confident & flirty", img: vibeFlirty },
  { id: "Dominant", label: "Dominant", img: vibeDominant },
  { id: "Submissive", label: "Submissive", img: vibeSubmissive },
  { id: "Playful brat", label: "Playful brat", img: vibeBrat },
  { id: "Romantic", label: "Romantic", img: vibeRomantic },
  { id: "Mysterious", label: "Mysterious", img: vibeMysterious },
  { id: "Goth", label: "Goth", img: vibeGoth },
  // No vibe-girl-next-door.jpg yet — its generation never came back. The
  // sundress shot is the closest read in the same set until it does.
  { id: "Girl next door", label: "Girl next door", img: outfitSundress },
];

const STEPS = ["Style", "Appearance", "Hair & eyes", "Outfit & vibe", "Finish"] as const;
const LAST_STEP = STEPS.length - 1;

function CreatePage() {
  const navigate = useNavigate();
  const generate = useServerFn(generateCharacter);

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender>("female");
  const [artStyle, setArtStyle] = useState<Style>("realistic");
  const [ethnicity, setEthnicity] = useState(ETHNICITIES[0]);
  const [age, setAge] = useState(22);
  const [body, setBody] = useState(BODIES[1].id);
  const [hair, setHair] = useState(HAIRS[0].id);
  const [eyes, setEyes] = useState(EYES[0].id);
  const [outfit, setOutfit] = useState(OUTFITS[0].id);
  const [fit, setFit] = useState<"slim" | "regular" | "loose">("slim");
  const [vibe, setVibe] = useState(VIBES[1].id);
  const [breast, setBreast] = useState("Medium");
  const [butt, setButt] = useState("Medium");
  const [loading, setLoading] = useState(false);

  const isWoman = gender === "female" || gender === "trans-female";

  // Each step is its own screen, so landing mid-page after "Next" reads as a
  // half-loaded page. Jump back to the top on every move.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

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
        data: {
          name: name.trim(),
          gender,
          artStyle,
          ethnicity,
          age,
          bodyType: body,
          hair,
          eyes,
          outfit,
          fit,
          vibe,
          breastSize: isWoman ? breast : undefined,
          buttSize: isWoman ? butt : undefined,
        },
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
    <div className="relative min-h-screen overflow-x-hidden bg-[#07050a] text-white">
      {/* Ambient glows — decorative only, kept behind everything and untappable. */}
      <div className="pointer-events-none absolute right-0 top-0 z-0 h-[500px] w-[500px] rounded-full bg-pink-500/5 blur-[120px]" />
      <div className="pointer-events-none absolute left-0 top-1/3 z-0 h-[600px] w-[600px] rounded-full bg-purple-500/5 blur-[150px]" />

      {/* SiteHeader is sticky on its own; wrapping both keeps the progress rail
          pinned directly beneath it without hard-coding the header's height. */}
      <div className="sticky top-0 z-40">
        <SiteHeader />
        <StepRail step={step} onJump={setStep} />
      </div>

      {/* Bottom padding clears the fixed action bar and, on mobile, BottomNav. */}
      <main className="relative z-10 mx-auto max-w-5xl px-4 pb-56 pt-6 md:px-6 lg:pb-32">
        {step === 0 && (
          <Step
            title="Who are you into?"
            sub="Pick a gender and an art style. Everything after this is her look."
          >
            <GenderPicker gender={gender} onChange={setGender} />

            <Section label="Art style">
              <div className="grid grid-cols-2 gap-3 md:gap-5">
                <StyleCard
                  img={imgRealistic}
                  title="Realistic"
                  sub="Photographic"
                  selected={artStyle === "realistic"}
                  onClick={() => setArtStyle("realistic")}
                />
                <StyleCard
                  img={imgAnime}
                  title="Anime"
                  sub="Manga-inspired"
                  selected={artStyle === "anime"}
                  onClick={() => setArtStyle("anime")}
                />
              </div>
            </Section>
          </Step>
        )}

        {step === 1 && (
          <Step title="Her look" sub="Ethnicity, age and the shape of her body.">
            <Section label="Ethnicity">
              <ChipRow
                options={ETHNICITIES.map((e) => ({ id: e, label: e }))}
                value={ethnicity}
                onChange={setEthnicity}
              />
            </Section>

            <Section label={`Age · ${age}`}>
              <input
                type="range"
                min={18}
                max={60}
                value={age}
                aria-label="Age"
                onChange={(e) => setAge(Number(e.target.value))}
                className="h-11 w-full accent-[hsl(var(--primary))]"
              />
              <div className="flex justify-between text-[11px] text-white/40">
                <span>18</span>
                <span>60</span>
              </div>
            </Section>

            <Section label="Body type">
              <PhotoGrid options={BODIES} value={body} onChange={setBody} />
            </Section>

            {isWoman && (
              <Section label="Breast size">
                <PhotoGrid options={BREASTS} value={breast} onChange={setBreast} />
              </Section>
            )}

            {isWoman && (
              <Section label="Butt size">
                <PhotoGrid options={BUTTS} value={butt} onChange={setButt} />
              </Section>
            )}
          </Step>
        )}

        {step === 2 && (
          <Step title="Hair & eyes" sub="The two things you'll notice first.">
            <Section label="Hair">
              <PhotoGrid options={HAIRS} value={hair} onChange={setHair} square />
            </Section>
            <Section label="Eye colour">
              <PhotoGrid options={EYES} value={eyes} onChange={setEyes} square />
            </Section>
          </Step>
        )}

        {step === 3 && (
          <Step title="Outfit & vibe" sub="What she wears, and how she talks to you.">
            <Section label="Outfit">
              <PhotoGrid options={OUTFITS} value={outfit} onChange={setOutfit} />
            </Section>
            <Section label="Fit">
              <ChipRow
                options={[
                  { id: "slim", label: "Slim · form-fitting" },
                  { id: "regular", label: "Regular" },
                  { id: "loose", label: "Loose · oversized" },
                ]}
                value={fit}
                onChange={(v) => setFit(v as "slim" | "regular" | "loose")}
              />
            </Section>
            <Section label="Personality">
              <PhotoGrid options={VIBES} value={vibe} onChange={setVibe} square />
            </Section>
          </Step>
        )}

        {step === LAST_STEP && (
          <Step title="Name her" sub="Last step — then she's generated and yours.">
            <Section label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Aria"
                maxLength={40}
                autoFocus
                className="h-14 rounded-2xl border-white/15 bg-white/5 text-lg"
              />
            </Section>

            <Section label="Your crush">
              <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {[
                  ["Style", artStyle],
                  ["Gender", gender.replace("-", " ")],
                  ["Ethnicity", ethnicity],
                  ["Age", String(age)],
                  ["Body", body],
                  ...(isWoman
                    ? ([
                        ["Breasts", breast],
                        ["Butt", butt],
                      ] as [string, string][])
                    : []),
                  ["Hair", hair],
                  ["Eyes", eyes],
                  ["Outfit", `${outfit} · ${fit}`],
                  ["Vibe", vibe],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5"
                  >
                    <dt className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                      {k}
                    </dt>
                    <dd className="mt-0.5 truncate text-sm font-semibold capitalize text-white">
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            </Section>
          </Step>
        )}
      </main>

      {/* Fixed so the way forward is always on screen. Sits above BottomNav on
          mobile, which is itself fixed at the bottom below the lg breakpoint. */}
      <div className="fixed inset-x-0 bottom-[68px] z-40 border-t border-white/10 bg-[#07050a]/90 backdrop-blur-xl lg:bottom-0">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 md:px-6">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="h-12 rounded-full px-4 text-sm text-white/70 hover:text-white disabled:opacity-30"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
          </Button>

          <p className="hidden text-xs text-white/40 sm:block">
            Step {step + 1} of {STEPS.length} · {STEPS[step]}
          </p>

          {step < LAST_STEP ? (
            <Button
              type="button"
              onClick={() => setStep((s) => Math.min(LAST_STEP, s + 1))}
              className="h-12 rounded-full bg-gradient-to-r from-pink-500 to-rose-500 px-8 text-sm font-bold uppercase tracking-wider text-white shadow-[0_0_20px_rgba(244,63,94,0.3)] transition duration-200 hover:brightness-110 active:scale-95 motion-reduce:transition-none"
            >
              Next <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={submit}
              disabled={loading}
              className="h-12 rounded-full bg-gradient-to-r from-pink-500 to-rose-500 px-6 text-sm font-bold uppercase tracking-wider text-white shadow-[0_0_25px_rgba(244,63,94,0.35)] transition duration-200 hover:brightness-110 active:scale-95 motion-reduce:transition-none"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <Wand2 className="mr-2 h-4 w-4" /> Generate her
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Layout ---------- */

function StepRail({ step, onJump }: { step: number; onJump: (n: number) => void }) {
  return (
    <div className="border-b border-white/5 bg-[#07050a]/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-5xl items-center gap-1.5 px-4 py-2.5 md:gap-2 md:px-6">
        {STEPS.map((label, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <button
              key={label}
              type="button"
              // Only steps already passed are reachable — jumping ahead would
              // skip choices the summary then reports as picked.
              disabled={i > step}
              onClick={() => onJump(i)}
              aria-current={current ? "step" : undefined}
              aria-label={`Step ${i + 1}: ${label}`}
              className="group flex min-w-0 flex-1 flex-col gap-1.5 py-1.5 text-left disabled:cursor-default"
            >
              <span
                className={`h-1 w-full rounded-full transition-colors duration-200 motion-reduce:transition-none ${
                  current
                    ? "bg-gradient-to-r from-pink-500 to-rose-500"
                    : done
                      ? "bg-pink-500/50"
                      : "bg-white/10"
                }`}
              />
              <span
                className={`truncate text-[10px] font-semibold uppercase tracking-wider ${
                  current ? "text-pink-400" : done ? "text-white/50" : "text-white/25"
                }`}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Step({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="space-y-8">
      <header>
        <p className="inline-flex items-center gap-2 rounded-full border border-pink-500/30 bg-pink-500/10 px-3 py-1 text-[11px] font-medium text-pink-400">
          <Sparkles className="h-3.5 w-3.5" /> 1 portrait credit
        </p>
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight md:text-5xl">
          {title}
        </h1>
        <p className="mt-2 max-w-lg text-sm font-light text-white/60 md:text-base">{sub}</p>
      </header>
      {children}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[11px] font-extrabold uppercase tracking-widest text-pink-400/80">
        {label}
      </h2>
      {children}
    </section>
  );
}

/* ---------- Pickers ---------- */

// Full-bleed photo, label burned into the bottom gradient, tick badge when
// picked — the option itself is the image, not a thumbnail beside a caption.
function PhotoGrid({
  options,
  value,
  onChange,
  square,
}: {
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  square?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:gap-3 lg:grid-cols-4">
      {options.map((o) => {
        const selected = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={selected}
            className={`group relative overflow-hidden rounded-2xl border text-left transition duration-200 motion-reduce:transition-none ${
              selected
                ? "border-pink-500 shadow-[0_0_25px_rgba(244,63,94,0.25)] ring-2 ring-pink-500"
                : "border-white/10 hover:border-white/25"
            }`}
          >
            <img
              src={o.img}
              alt={o.label}
              loading="lazy"
              width={448}
              height={square ? 448 : 672}
              className={`w-full bg-black/40 object-cover object-top transition duration-500 group-hover:scale-[1.04] motion-reduce:transition-none ${
                square ? "aspect-square" : "aspect-[2/3]"
              }`}
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />

            {selected && (
              <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-gradient-to-r from-pink-500 to-rose-500 shadow-md">
                <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
              </span>
            )}

            <span
              className={`absolute inset-x-0 bottom-0 px-3 pb-2.5 pt-6 text-sm font-semibold drop-shadow ${
                selected ? "text-white" : "text-white/85"
              }`}
            >
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function StyleCard({
  img,
  title,
  sub,
  selected,
  onClick,
}: {
  img: string;
  title: string;
  sub: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`group relative aspect-[3/4] overflow-hidden rounded-3xl border transition duration-200 motion-reduce:transition-none ${
        selected
          ? "border-pink-500 shadow-[0_0_30px_rgba(244,63,94,0.3)] ring-2 ring-pink-500"
          : "border-white/10 hover:border-white/25"
      }`}
    >
      <img
        src={img}
        alt={title}
        className="absolute inset-0 h-full w-full object-cover object-top transition duration-500 group-hover:scale-105 motion-reduce:transition-none"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent" />
      {selected && (
        <span className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-gradient-to-r from-pink-500 to-rose-500 shadow-md">
          <Check className="h-4 w-4 text-white" strokeWidth={3} />
        </span>
      )}
      <div className="absolute inset-x-0 bottom-5 text-center">
        <span className="font-display text-lg font-bold uppercase tracking-wide text-white drop-shadow-md sm:text-2xl">
          {title}
        </span>
        <p className="mt-1 text-[10px] text-white/70 sm:text-xs">{sub}</p>
      </div>
    </button>
  );
}

function GenderPicker({ gender, onChange }: { gender: Gender; onChange: (g: Gender) => void }) {
  const isGirl = gender === "female" || gender === "trans-female";
  const isGuy = gender === "male" || gender === "trans-male";

  return (
    <Section label="Gender">
      <div className="flex justify-center">
        <div className="flex rounded-full border border-white/10 bg-neutral-900 p-1.5">
          <button
            type="button"
            onClick={() => onChange("female")}
            aria-pressed={isGirl}
            className={`h-11 rounded-full px-7 text-sm font-bold uppercase transition duration-200 motion-reduce:transition-none ${
              isGirl
                ? "bg-grad-primary text-primary-foreground shadow-glow"
                : "text-white/60 hover:text-white"
            }`}
          >
            ♀ Girls
          </button>
          <button
            type="button"
            onClick={() => onChange("male")}
            aria-pressed={isGuy}
            className={`h-11 rounded-full px-7 text-sm font-bold uppercase transition duration-200 motion-reduce:transition-none ${
              isGuy
                ? "bg-grad-primary text-primary-foreground shadow-glow"
                : "text-white/60 hover:text-white"
            }`}
          >
            ♂ Guys
          </button>
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {isGirl && (
          <>
            <GenderChip current={gender} id="female" label="♀ Girls" onChange={onChange} />
            <GenderChip current={gender} id="trans-female" label="⚧ Trans" onChange={onChange} />
          </>
        )}
        {isGuy && (
          <>
            <GenderChip current={gender} id="male" label="♂ Guys" onChange={onChange} />
            <GenderChip current={gender} id="trans-male" label="⚧ Trans" onChange={onChange} />
          </>
        )}
        <GenderChip current={gender} id="non-binary" label="✦ Non-binary" onChange={onChange} />
      </div>
    </Section>
  );
}

function GenderChip({
  current,
  id,
  label,
  onChange,
}: {
  current: Gender;
  id: Gender;
  label: string;
  onChange: (g: Gender) => void;
}) {
  const selected = current === id;
  return (
    <button
      type="button"
      onClick={() => onChange(id)}
      aria-pressed={selected}
      className={`h-11 rounded-full border px-5 text-xs font-semibold transition duration-200 motion-reduce:transition-none ${
        selected
          ? "border-primary bg-primary/10 text-primary"
          : "border-white/10 bg-white/5 text-white/60 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function ChipRow({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const selected = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={selected}
            className={`h-11 rounded-full border px-5 text-xs font-semibold transition duration-200 motion-reduce:transition-none ${
              selected
                ? "border-transparent bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-[0_0_15px_rgba(244,63,94,0.25)]"
                : "border-white/10 bg-white/5 text-white/50 hover:bg-white/10 hover:text-white"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
