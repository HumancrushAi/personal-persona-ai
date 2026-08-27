import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { generateCharacter } from "@/lib/characters.functions";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Heart, Sparkles, Wand2, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import bodySlim from "@/assets/create/body-slim.jpg";
import bodyAthletic from "@/assets/create/body-athletic.jpg";
import bodyCurvy from "@/assets/create/body-curvy.jpg";
import bodyPetite from "@/assets/create/body-petite.jpg";
import bodyTall from "@/assets/create/body-tall.jpg";
import bodyThick from "@/assets/create/body-thick.jpg";
import bodyMuscular from "@/assets/create/body-muscular.jpg";
import outfitCrop from "@/assets/create/outfit-crop.jpg";
import outfitBlack from "@/assets/create/outfit-black-dress.jpg";
import outfitSundress from "@/assets/create/outfit-sundress.jpg";
import outfitWorkout from "@/assets/create/outfit-workout.jpg";
import outfitHoodie from "@/assets/create/outfit-hoodie.jpg";
import outfitSilk from "@/assets/create/outfit-silk.jpg";
import outfitStreet from "@/assets/create/outfit-streetwear.jpg";
import outfitGown from "@/assets/create/outfit-gown.jpg";
import breastSmall from "@/assets/create/breast-small.jpg";
import breastMedium from "@/assets/create/breast-medium.jpg";
import breastLarge from "@/assets/create/breast-large.jpg";
import breastBusty from "@/assets/create/breast-busty.jpg";
import imgRealistic from "@/assets/companions/01-aria.jpg";
import imgAnime from "@/assets/companions/anime1.jpg";

function PhotoSwatch({ src, alt }: { src: string; alt: string }) {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      width={512}
      height={768}
      className="aspect-[4/5] w-full rounded-xl object-cover object-top transition duration-300 group-hover:scale-105"
    />
  );
}

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

/* ---------- Visual swatches (lightweight illustrations) ---------- */

function Silhouette({
  w,
  tall,
  short,
  hips,
  muscular,
}: {
  w: number;
  tall?: boolean;
  short?: boolean;
  hips?: boolean;
  muscular?: boolean;
}) {
  const height = tall ? 70 : short ? 50 : 60;
  const shoulder = muscular ? w + 6 : w + 2;
  const hip = hips ? w + 8 : w + 2;
  return (
    <svg viewBox="0 0 60 80" className="h-14 w-full">
      <defs>
        <linearGradient id="sil" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="hsl(var(--primary))" stopOpacity="0.9" />
          <stop offset="1" stopColor="hsl(var(--primary))" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <circle cx="30" cy={40 - height / 2 + 6} r="5" fill="url(#sil)" />
      <path
        d={`M${30 - shoulder / 2},${46 - height / 2 + 4}
            C${30 - w / 2},${50 - height / 2 + 4} ${30 - w / 2},${30 + height / 4} ${30 - hip / 2},${40 + height / 2 - 6}
            L${30 + hip / 2},${40 + height / 2 - 6}
            C${30 + w / 2},${30 + height / 4} ${30 + w / 2},${50 - height / 2 + 4} ${30 + shoulder / 2},${46 - height / 2 + 4}
            Z`}
        fill="url(#sil)"
      />
    </svg>
  );
}

function HairSwatch({
  color,
  long,
  wavy,
  curly,
}: {
  color: string;
  long?: boolean;
  wavy?: boolean;
  curly?: boolean;
}) {
  return (
    <svg viewBox="0 0 60 60" className="h-14 w-full">
      {/* face */}
      <circle cx="30" cy="32" r="13" fill="#f3d3bd" />
      {/* hair cap */}
      <path
        d={
          curly
            ? "M14,28 q0,-18 16,-18 q16,0 16,18 q-4,-6 -10,-4 q-2,-4 -6,0 q-4,-4 -8,2 q-2,-2 -8,2 z"
            : "M14,28 q0,-18 16,-18 q16,0 16,18 q-3,-2 -6,-1 q-3,-3 -6,-1 q-4,-3 -7,-1 q-4,-2 -7,-1 q-3,-1 -6,1 z"
        }
        fill={color}
      />
      {/* long flowing strands */}
      {long && (
        <path
          d={
            wavy
              ? "M14,30 q-2,12 1,22 q3,-3 5,-1 q-1,-10 1,-18 z M46,30 q2,12 -1,22 q-3,-3 -5,-1 q1,-10 -1,-18 z"
              : "M14,30 q-1,12 2,22 l4,0 q-2,-12 0,-22 z M46,30 q1,12 -2,22 l-4,0 q2,-12 0,-22 z"
          }
          fill={color}
        />
      )}
    </svg>
  );
}

function EyeSwatch({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 60 60" className="h-14 w-full">
      <ellipse cx="30" cy="30" rx="22" ry="11" fill="#fff" />
      <ellipse cx="30" cy="30" rx="22" ry="11" fill="none" stroke="#1a0d10" strokeWidth="2" />
      <circle cx="30" cy="30" r="9" fill={color} />
      <circle cx="30" cy="30" r="4" fill="#0a0a0c" />
      <circle cx="32" cy="28" r="1.4" fill="#fff" />
    </svg>
  );
}

function OutfitSwatch({ top, bottom, emoji }: { top: string; bottom: string; emoji: string }) {
  return (
    <div className="relative h-14 w-full overflow-hidden rounded-lg">
      <div className="absolute inset-x-0 top-0 h-1/2" style={{ background: top }} />
      <div className="absolute inset-x-0 bottom-0 h-1/2" style={{ background: bottom }} />
      <div className="absolute inset-0 grid place-items-center text-2xl drop-shadow">{emoji}</div>
    </div>
  );
}

function VibeSwatch({ emoji, hue }: { emoji: string; hue: string }) {
  return (
    <div className={`grid h-14 w-full place-items-center rounded-lg bg-gradient-to-br ${hue}`}>
      <span className="text-2xl drop-shadow">{emoji}</span>
    </div>
  );
}

type Visual = { id: string; label: string; swatch: React.ReactNode };

const BODIES: Visual[] = [
  { id: "Slim", label: "Slim", swatch: <PhotoSwatch src={bodySlim} alt="Slim" /> },
  { id: "Athletic", label: "Athletic", swatch: <PhotoSwatch src={bodyAthletic} alt="Athletic" /> },
  { id: "Curvy", label: "Curvy", swatch: <PhotoSwatch src={bodyCurvy} alt="Curvy" /> },
  { id: "Petite", label: "Petite", swatch: <PhotoSwatch src={bodyPetite} alt="Petite" /> },
  { id: "Tall", label: "Tall", swatch: <PhotoSwatch src={bodyTall} alt="Tall" /> },
  { id: "Thick", label: "Thick", swatch: <PhotoSwatch src={bodyThick} alt="Thick" /> },
  { id: "Muscular", label: "Muscular", swatch: <PhotoSwatch src={bodyMuscular} alt="Muscular" /> },
];

const BREASTS: Visual[] = [
  { id: "Small", label: "Small (A)", swatch: <PhotoSwatch src={breastSmall} alt="Small" /> },
  { id: "Medium", label: "Medium (B/C)", swatch: <PhotoSwatch src={breastMedium} alt="Medium" /> },
  { id: "Large", label: "Large (D)", swatch: <PhotoSwatch src={breastLarge} alt="Large" /> },
  { id: "Busty", label: "Busty (DD+)", swatch: <PhotoSwatch src={breastBusty} alt="Busty" /> },
];

const BUTTS: Visual[] = [
  { id: "Small", label: "Small / Petite", swatch: <PhotoSwatch src={bodyPetite} alt="Small" /> },
  { id: "Medium", label: "Medium / Athletic", swatch: <PhotoSwatch src={bodyAthletic} alt="Medium" /> },
  { id: "Large", label: "Large / Curvy", swatch: <PhotoSwatch src={bodyCurvy} alt="Large" /> },
  { id: "Big", label: "Big / Voluptuous", swatch: <PhotoSwatch src={bodyThick} alt="Big" /> },
];

const HAIRS: Visual[] = [
  { id: "Long black", label: "Long black", swatch: <HairSwatch color="#0b0b0d" long /> },
  { id: "Long blonde", label: "Long blonde", swatch: <HairSwatch color="#e9c77a" long /> },
  { id: "Long brunette", label: "Long brunette", swatch: <HairSwatch color="#4a2c1a" long /> },
  { id: "Short pixie", label: "Short pixie", swatch: <HairSwatch color="#1a1a1a" /> },
  { id: "Bob cut", label: "Bob cut", swatch: <HairSwatch color="#2a1a10" /> },
  { id: "Wavy red", label: "Wavy red", swatch: <HairSwatch color="#b3431d" long wavy /> },
  { id: "Pink dyed", label: "Pink dyed", swatch: <HairSwatch color="#ff6fb1" long /> },
  { id: "Curly afro", label: "Curly afro", swatch: <HairSwatch color="#1a1310" curly /> },
  { id: "Silver", label: "Silver", swatch: <HairSwatch color="#c9cad0" long /> },
];

const EYES: Visual[] = [
  { id: "Brown", label: "Brown", swatch: <EyeSwatch color="#5a3a1c" /> },
  { id: "Hazel", label: "Hazel", swatch: <EyeSwatch color="#8a6a32" /> },
  { id: "Green", label: "Green", swatch: <EyeSwatch color="#3a8a4a" /> },
  { id: "Blue", label: "Blue", swatch: <EyeSwatch color="#2f6dc9" /> },
  { id: "Grey", label: "Grey", swatch: <EyeSwatch color="#8a96a4" /> },
  { id: "Amber", label: "Amber", swatch: <EyeSwatch color="#c7821f" /> },
];

const OUTFITS: Visual[] = [
  {
    id: "Crop top + jeans",
    label: "Crop top + jeans",
    swatch: <PhotoSwatch src={outfitCrop} alt="Crop top + jeans" />,
  },
  {
    id: "Black dress",
    label: "Black dress",
    swatch: <PhotoSwatch src={outfitBlack} alt="Black dress" />,
  },
  {
    id: "Sundress",
    label: "Sundress",
    swatch: <PhotoSwatch src={outfitSundress} alt="Sundress" />,
  },
  {
    id: "Workout set",
    label: "Workout set",
    swatch: <PhotoSwatch src={outfitWorkout} alt="Workout set" />,
  },
  {
    id: "Oversized hoodie",
    label: "Oversized hoodie",
    swatch: <PhotoSwatch src={outfitHoodie} alt="Oversized hoodie" />,
  },
  {
    id: "Silk blouse",
    label: "Silk blouse",
    swatch: <PhotoSwatch src={outfitSilk} alt="Silk blouse" />,
  },
  {
    id: "Streetwear",
    label: "Streetwear",
    swatch: <PhotoSwatch src={outfitStreet} alt="Streetwear" />,
  },
  {
    id: "Evening gown",
    label: "Evening gown",
    swatch: <PhotoSwatch src={outfitGown} alt="Evening gown" />,
  },
];

const VIBES: Visual[] = [
  {
    id: "Sweet & shy",
    label: "Sweet & shy",
    swatch: <VibeSwatch emoji="🥺" hue="from-pink-400/60 to-rose-300/60" />,
  },
  {
    id: "Confident & flirty",
    label: "Confident & flirty",
    swatch: <VibeSwatch emoji="😉" hue="from-fuchsia-500/70 to-rose-400/60" />,
  },
  {
    id: "Dominant",
    label: "Dominant",
    swatch: <VibeSwatch emoji="🔥" hue="from-red-600/70 to-orange-500/60" />,
  },
  {
    id: "Submissive",
    label: "Submissive",
    swatch: <VibeSwatch emoji="🎀" hue="from-pink-300/60 to-rose-200/60" />,
  },
  {
    id: "Playful brat",
    label: "Playful brat",
    swatch: <VibeSwatch emoji="😈" hue="from-violet-500/70 to-fuchsia-500/60" />,
  },
  {
    id: "Romantic",
    label: "Romantic",
    swatch: <VibeSwatch emoji="💖" hue="from-rose-400/70 to-pink-300/60" />,
  },
  {
    id: "Mysterious",
    label: "Mysterious",
    swatch: <VibeSwatch emoji="🌙" hue="from-indigo-700/70 to-slate-700/60" />,
  },
  {
    id: "Goth",
    label: "Goth",
    swatch: <VibeSwatch emoji="🦇" hue="from-zinc-800/80 to-purple-900/70" />,
  },
  {
    id: "Girl next door",
    label: "Girl next door",
    swatch: <VibeSwatch emoji="🌻" hue="from-amber-300/70 to-yellow-200/60" />,
  },
];

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

  if (step === 0) {
    const isGirl = gender === "female" || gender === "trans-female";
    const isGuy = gender === "male" || gender === "trans-male";
    const headerTitle = isGirl
      ? "Create my AI Girl"
      : isGuy
      ? "Create my AI Guy"
      : "Create my AI Companion";

    return (
      <div className="min-h-screen pb-24 bg-neutral-950 text-white">
        <SiteHeader />
        
        <section className="mx-auto max-w-3xl px-4 py-8 md:px-6">
          <div className="text-center">
            <h1 className="font-display text-3xl font-extrabold tracking-tight md:text-5xl bg-gradient-to-r from-white via-neutral-100 to-neutral-400 bg-clip-text text-transparent">
              {headerTitle}
            </h1>
            <p className="mt-2 text-sm text-neutral-400">
              Pick your preferred art style and gender to get started.
            </p>
          </div>

          {/* Gender Tab Selection (Girls vs Guys) */}
          <div className="mt-8 flex justify-center">
            <div className="flex bg-neutral-900 border border-white/10 p-1.5 rounded-full">
              <button
                type="button"
                onClick={() => setGender("female")}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-bold uppercase transition ${
                  isGirl ? "bg-grad-primary text-primary-foreground shadow-glow" : "text-white/60 hover:text-white"
                }`}
              >
                ♀ Girls
              </button>
              <button
                type="button"
                onClick={() => setGender("male")}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-bold uppercase transition ${
                  isGuy ? "bg-grad-primary text-primary-foreground shadow-glow" : "text-white/60 hover:text-white"
                }`}
              >
                ♂ Guys
              </button>
            </div>
          </div>

          {/* Sub-Gender Buttons */}
          <div className="mt-4 flex justify-center gap-2">
            {isGirl && (
              <>
                <button
                  type="button"
                  onClick={() => setGender("female")}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition ${
                    gender === "female"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-white/10 bg-white/5 text-white/60 hover:text-white"
                  }`}
                >
                  ♀ Girls
                </button>
                <button
                  type="button"
                  onClick={() => setGender("trans-female")}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition ${
                    gender === "trans-female"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-white/10 bg-white/5 text-white/60 hover:text-white"
                  }`}
                >
                  ⚧ Trans
                </button>
              </>
            )}
            {isGuy && (
              <>
                <button
                  type="button"
                  onClick={() => setGender("male")}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition ${
                    gender === "male"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-white/10 bg-white/5 text-white/60 hover:text-white"
                  }`}
                >
                  ♂ Guys
                </button>
                <button
                  type="button"
                  onClick={() => setGender("trans-male")}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition ${
                    gender === "trans-male"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-white/10 bg-white/5 text-white/60 hover:text-white"
                  }`}
                >
                  ⚧ Trans
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setGender("non-binary")}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition ${
                gender === "non-binary"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-white/10 bg-white/5 text-white/60 hover:text-white"
              }`}
            >
              ✦ Non-binary
            </button>
          </div>

          {/* Art Style Choice (Realistic vs Anime Cards) */}
          <div className="mt-8 grid grid-cols-2 gap-4 md:gap-6">
            {/* Card 1: Realistic */}
            <button
              type="button"
              onClick={() => setArtStyle("realistic")}
              className={`group relative aspect-[3/4] overflow-hidden rounded-3xl border transition-all duration-300 ${
                artStyle === "realistic"
                  ? "border-primary bg-primary/5 ring-4 ring-primary/40 scale-[1.02] shadow-glow"
                  : "border-white/10 bg-neutral-900 hover:border-white/20 hover:scale-[1.01]"
              }`}
            >
              <img
                src={imgRealistic}
                alt="Realistic"
                className="absolute inset-0 h-full w-full object-cover object-top transition duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />
              <div className="absolute bottom-6 left-0 right-0 text-center">
                <span className="font-display text-lg font-bold text-white tracking-wide uppercase sm:text-2xl drop-shadow-md">
                  Realistic
                </span>
                <p className="text-[10px] text-white/70 mt-1 sm:text-xs">Photographic style</p>
              </div>
            </button>

            {/* Card 2: Anime */}
            <button
              type="button"
              onClick={() => setArtStyle("anime")}
              className={`group relative aspect-[3/4] overflow-hidden rounded-3xl border transition-all duration-300 ${
                artStyle === "anime"
                  ? "border-primary bg-primary/5 ring-4 ring-primary/40 scale-[1.02] shadow-glow"
                  : "border-white/10 bg-neutral-900 hover:border-white/20 hover:scale-[1.01]"
              }`}
            >
              <img
                src={imgAnime}
                alt="Anime"
                className="absolute inset-0 h-full w-full object-cover object-top transition duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />
              <div className="absolute bottom-6 left-0 right-0 text-center">
                <span className="font-display text-lg font-bold text-white tracking-wide uppercase sm:text-2xl drop-shadow-md">
                  Anime
                </span>
                <p className="text-[10px] text-white/70 mt-1 sm:text-xs">Manga-inspired style</p>
              </div>
            </button>
          </div>

          {/* NEXT Button */}
          <div className="mt-10 flex justify-center">
            <Button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-full bg-grad-primary px-10 py-6 text-sm font-extrabold tracking-wider uppercase text-primary-foreground shadow-glow hover:opacity-95 active:scale-95 transition"
            >
              NEXT →
            </Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24">
      <SiteHeader />

      <section className="mx-auto max-w-5xl px-4 py-6 md:px-6">
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setStep(0)}
            className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white transition"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Art Style / Gender selection
          </button>
        </div>

        <div className="glass rounded-3xl p-5 md:p-8">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Create your AI · 1 portrait credit
          </p>
          <h1 className="mt-3 font-display text-3xl font-semibold md:text-5xl">
            Build your <span className="text-primary">crush</span>.
          </h1>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground md:text-base">
            Pick the look. We generate her, then you fine-tune her personality.
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-[1fr_1fr]">
          {/* LEFT — basics */}
          <div className="space-y-5 rounded-3xl border border-white/10 bg-card p-5">
            <Field label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Aria"
                maxLength={40}
              />
            </Field>

            <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-wider text-white/50 font-bold mb-1">Active Choice</p>
              <div className="flex gap-4 text-xs font-semibold">
                <p>Art Style: <span className="text-primary uppercase">{artStyle}</span></p>
                <p>Gender: <span className="text-primary uppercase">{gender}</span></p>
              </div>
            </div>

            <Field label={`Age · ${age}`}>
              <input
                type="range"
                min={18}
                max={60}
                value={age}
                onChange={(e) => setAge(Number(e.target.value))}
                className="w-full accent-[hsl(var(--primary))]"
              />
            </Field>

            <Field label="Ethnicity">
              <ChipRow
                options={ETHNICITIES.map((e) => ({ id: e, label: e }))}
                value={ethnicity}
                onChange={setEthnicity}
              />
            </Field>
          </div>

          {/* RIGHT — appearance + vibe */}
          <div className="space-y-5 rounded-3xl border border-white/10 bg-card p-5">
            <Field label="Body Type">
              <VisualGrid options={BODIES} value={body} onChange={setBody} />
            </Field>
            {isWoman && (
              <Field label="Breast Size">
                <VisualGrid options={BREASTS} value={breast} onChange={setBreast} />
              </Field>
            )}
            {isWoman && (
              <Field label="Butt Size">
                <VisualGrid options={BUTTS} value={butt} onChange={setButt} />
              </Field>
            )}
            <Field label="Hair Style">
              <VisualGrid options={HAIRS} value={hair} onChange={setHair} />
            </Field>
            <Field label="Eye Color">
              <VisualGrid options={EYES} value={eyes} onChange={setEyes} />
            </Field>
            <Field label="Outfit">
              <VisualGrid options={OUTFITS} value={outfit} onChange={setOutfit} />
            </Field>
            <Field label="Outfit Fit">
              <ChipRow
                options={[
                  { id: "slim", label: "Slim · form-fitting" },
                  { id: "regular", label: "Regular" },
                  { id: "loose", label: "Loose · oversized" },
                ]}
                value={fit}
                onChange={(v) => setFit(v as "slim" | "regular" | "loose")}
              />
            </Field>
            <Field label="Personality & Vibe">
              <VisualGrid options={VIBES} value={vibe} onChange={setVibe} />
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
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Generating your crush…
              </>
            ) : (
              <>
                <Wand2 className="mr-2 h-5 w-5" /> Generate AI character
              </>
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

function toOpts(v: Visual[]): { id: string; label: string }[] {
  return v.map((o) => ({ id: o.id, label: o.label }));
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
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`min-h-11 rounded-full border px-3.5 py-2 text-xs font-medium transition ${
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

function VisualGrid({
  options,
  value,
  onChange,
}: {
  options: Visual[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
      {options.map((o) => {
        const isSelected = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`group relative flex flex-col items-center overflow-hidden rounded-2xl border p-1.5 text-center transition-all duration-200 ${
              isSelected
                ? "border-primary bg-primary/10 ring-2 ring-primary shadow-glow scale-[1.02]"
                : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10 hover:scale-[1.01]"
            }`}
          >
            <div className="w-full overflow-hidden rounded-xl bg-black/40">
              {o.swatch}
            </div>
            <div className="mt-1.5 flex items-center justify-center gap-1 px-1 pb-0.5">
              <span
                className={`text-xs font-semibold tracking-tight transition ${
                  isSelected ? "text-primary" : "text-white/80 group-hover:text-white"
                }`}
              >
                {o.label}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
