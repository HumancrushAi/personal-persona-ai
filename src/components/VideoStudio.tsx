import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Film, Settings2, Sparkles } from "lucide-react";

// Scene-by-scene video composer.
//
// The RunPod endpoint takes a prompts ARRAY and a num_scenes count and stitches
// the shots into one clip, so this is the endpoint's own feature rather than
// several jobs glued together. Each filled field is one shot, in order.
//
// Cost scales with scene count because each scene is a separate render.

export type VideoSettings = {
  fps: number;
  framesPerScene: number;
  samplingSteps: number;
};

export const DEFAULT_SETTINGS: VideoSettings = {
  fps: 16,
  framesPerScene: 82, // ~5s per scene at 16fps
  samplingSteps: 10,
};

const DEFAULT_SCENE_COUNT = 10;

// Starting points, phrased as things that happen on camera. They're editable —
// the field is the product, these just stop the user facing ten blank boxes.
const SCENE_IDEAS = [
  "Standing in a luxury marble shower, water running down her body, one hand in her hair",
  "Taking a mirror selfie in a luxury bedroom, holding her phone, biting her lip",
  "Leaning over a marble kitchen counter, looking back over her shoulder",
  "On a penthouse balcony at night, city lights behind her, one leg up on the railing",
  "Lying back in a bubble bath, wet hair, candlelight",
  "On a towel on a tropical beach at golden hour, stretching slowly",
  "In front of a gym mirror after a workout, sweat on her skin, hair in a ponytail",
  "Sitting on the hood of a sports car at night under street lights",
  "Standing at a floor-to-ceiling window at sunset, looking back over her shoulder",
  "Lying on silk sheets, hair spread out, holding eye contact with the camera",
];

export function VideoStudio({
  name,
  perSceneCost,
  onClose,
  onGenerate,
}: {
  name: string;
  perSceneCost: number;
  onClose: () => void;
  onGenerate: (scenes: string[], settings: VideoSettings) => void;
}) {
  const [scenes, setScenes] = useState<string[]>(() =>
    Array.from({ length: DEFAULT_SCENE_COUNT }, () => ""),
  );
  const [settings, setSettings] = useState<VideoSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);

  const filled = scenes.map((s) => s.trim()).filter(Boolean);
  const cost = perSceneCost * Math.max(1, filled.length);
  const seconds = ((settings.framesPerScene / settings.fps) * Math.max(1, filled.length)).toFixed(0);

  function setScene(i: number, value: string) {
    setScenes((prev) => prev.map((s, idx) => (idx === i ? value : s)));
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/85 backdrop-blur-sm md:items-center md:p-6">
      <div className="flex h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-card shadow-glow md:h-[85vh] md:rounded-3xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-white/10 p-4">
          <Film className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <p className="font-display text-base font-semibold">Make a video with {name}</p>
            <p className="text-[11px] text-muted-foreground">
              One prompt per scene — they play in order.
            </p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-white/10" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {/* Section 1 — settings */}
          <div className="rounded-2xl border border-white/10 bg-white/5">
            <button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              className="flex w-full items-center gap-2 p-3 text-left"
            >
              <Settings2 className="h-4 w-4 text-primary" />
              <span className="flex-1 text-sm font-medium">Settings</span>
              <span className="text-[11px] text-muted-foreground">
                {settings.fps}fps · {(settings.framesPerScene / settings.fps).toFixed(1)}s/scene ·{" "}
                {settings.samplingSteps} steps
              </span>
            </button>
            {showSettings && (
              <div className="grid grid-cols-3 gap-3 border-t border-white/10 p-3">
                <Field
                  label="FPS"
                  value={settings.fps}
                  min={8}
                  max={30}
                  onChange={(v) => setSettings((s) => ({ ...s, fps: v }))}
                />
                <Field
                  label="Frames / scene"
                  value={settings.framesPerScene}
                  min={16}
                  max={160}
                  onChange={(v) => setSettings((s) => ({ ...s, framesPerScene: v }))}
                />
                <Field
                  label="Steps"
                  value={settings.samplingSteps}
                  min={4}
                  max={40}
                  onChange={(v) => setSettings((s) => ({ ...s, samplingSteps: v }))}
                />
              </div>
            )}
          </div>

          {/* Section 2 — one prompt per scene */}
          <div className="space-y-2">
            {scenes.map((scene, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-2.5 w-5 shrink-0 text-right text-[11px] font-semibold text-muted-foreground">
                  {i + 1}
                </span>
                <textarea
                  value={scene}
                  onChange={(e) => setScene(i, e.target.value)}
                  placeholder={SCENE_IDEAS[i] ?? "Describe this scene…"}
                  rows={2}
                  maxLength={1200}
                  className="min-h-[46px] flex-1 resize-y rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/35 focus:border-primary/50"
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() => setScenes(SCENE_IDEAS.slice(0, DEFAULT_SCENE_COUNT))}
              className="ml-7 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <Sparkles className="h-3 w-3" /> Fill with suggestions
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="space-y-2 border-t border-white/10 p-4">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {filled.length || 0} scene{filled.length === 1 ? "" : "s"} · ~{seconds}s
            </span>
            <span>{cost} credits</span>
          </div>
          <Button
            onClick={() => onGenerate(filled, settings)}
            disabled={filled.length === 0}
            className="w-full rounded-full bg-grad-primary text-primary-foreground shadow-glow"
          >
            Generate
          </Button>
          <p className="text-center text-[10px] text-muted-foreground">
            Each scene renders separately, so more scenes cost more and take longer.
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          // Clamp here as well as server-side: the endpoint silently misbehaves
          // on out-of-range values rather than rejecting them.
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))));
        }}
        className="h-9 border-white/10 bg-white/5 text-sm"
      />
    </label>
  );
}
