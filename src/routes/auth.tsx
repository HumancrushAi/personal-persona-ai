import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { AuthForm } from "@/components/auth/AuthForm";
import { LogoLink } from "@/components/Logo";
import { companionImage } from "@/lib/companion-images";
import { goBackOrExplore } from "@/lib/back-navigation";
import { orderModelsForDisplay } from "@/lib/display-models";
import { supabase } from "@/integrations/supabase/client";

const authSearchSchema = z.object({ companion: z.string().optional(), redirect: z.string().optional(), mode: z.enum(["signin", "signup"]).optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: (search) => authSearchSchema.parse(search),
  head: () => ({ meta: [{ title: "Sign in | HumanCrush" }] }),
  component: AuthPage,
});

type AuthModel = { id: string; name: string; image_url: string; gender?: string | null };

function AuthPage() {
  const navigate = useNavigate();
  const { companion, redirect, mode } = Route.useSearch();
  const [models, setModels] = useState<AuthModel[]>([]);

  useEffect(() => {
    supabase.from("companions").select("id,name,image_url,gender").order("sort_order").then(({ data }) => setModels((data ?? []) as AuthModel[]));
  }, []);

  const tiles = useMemo(() => {
    const ordered = orderModelsForDisplay(models).slice(0, 8);
    return ordered.length ? [...ordered, ...ordered] : [];
  }, [models]);
  const resume = () => {
    if (redirect) navigate({ to: redirect as never });
    else if (companion) navigate({ to: "/companion/$id", params: { id: companion } });
    else navigate({ to: "/browse" });
  };

  return <div className="min-h-screen bg-[#111113] text-white lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(420px,.92fr)]">
    <button type="button" aria-label="Back" onClick={() => goBackOrExplore()} className="fixed left-4 top-4 z-30 grid h-11 w-11 place-items-center rounded-full border border-white/[0.14] bg-[#111113]/80 text-white backdrop-blur transition hover:bg-white/[0.1] sm:left-6 sm:top-6"><ArrowLeft className="h-5 w-5" /></button>
    <section aria-label="HumanCrush preview" className="relative overflow-hidden border-b border-white/[0.08] bg-[#18181B] lg:min-h-screen lg:border-b-0 lg:border-r">
      <div className="h-24 overflow-hidden px-3 py-3 sm:h-28 sm:px-5 lg:absolute lg:inset-0 lg:h-auto lg:px-10 lg:py-10">
        <div className="flex h-full gap-2 overflow-hidden lg:grid lg:grid-cols-3 lg:gap-4">
          {tiles.map((model, index) => <figure key={`${model.id}-${index}`} className="relative h-full w-[72px] shrink-0 overflow-hidden rounded-xl bg-[#27272A] sm:w-[88px] lg:w-auto lg:rounded-2xl"><img src={companionImage(model.image_url)} alt="" className="h-full w-full object-cover object-top lg:scale-110" /><figcaption className="absolute inset-x-0 bottom-0 hidden bg-gradient-to-t from-black/80 to-transparent p-3 pt-8 text-xs font-semibold text-white lg:block">{model.name}</figcaption></figure>)}
        </div>
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-[62%] bg-gradient-to-t from-[#18181B] via-[#18181B]/95 to-transparent lg:block" />
      <div className="hidden lg:absolute lg:bottom-12 lg:left-12 lg:right-12 lg:block"><LogoLink className="h-9" /><p className="mt-8 max-w-md font-display text-5xl font-extrabold leading-[.98] tracking-[-.055em]">Create with a face you can keep.</p><p className="mt-5 max-w-md text-base leading-relaxed text-[#A1A1AA]">Save your models, renders and credits in one account. Every character on HumanCrush is a fictional, AI-generated adult.</p></div>
    </section>
    <main className="flex min-h-[calc(100dvh-6rem)] items-start justify-center px-5 py-12 sm:px-8 sm:py-16 lg:min-h-screen lg:items-center lg:px-12">
      <div className="w-full max-w-[420px]"><div className="mb-8 lg:hidden"><LogoLink className="h-8" /></div><AuthForm initialScreen={mode ?? "signup"} redirectPath={redirect} companionId={companion} onAuthenticated={resume} /></div>
    </main>
  </div>;
}
