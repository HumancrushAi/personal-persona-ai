import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/done-for-you")({ ssr: false, component: DoneForYou });

const OFFER_KEY = "hc:business-offer-deadline";
const tiers = [
  { name: "Creator", price: "$29", detail: "Monthly", copy: "Generate images and videos with credits, using the standalone creator and your saved models." },
  { name: "Creator annual", price: "$249", detail: "Per year", copy: "The same creator workspace with a lower effective monthly price and a larger included credit balance." },
  { name: "Done-for-you", price: "Let's talk", detail: "Custom build", copy: "One complete model business: brand, model site, launch-ready image and video library, and social setup guidance." },
];

function DoneForYou() {
  const navigate = useNavigate();
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const saved = Number(window.localStorage.getItem(OFFER_KEY));
    const deadline = Number.isFinite(saved) && saved > Date.now() ? saved : Date.now() + 24 * 60 * 60 * 1000;
    window.localStorage.setItem(OFFER_KEY, String(deadline));
    setRemaining(Math.max(0, deadline - Date.now()));
    const timer = window.setInterval(() => setRemaining(Math.max(0, deadline - Date.now())), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const hours = Math.floor(remaining / 3_600_000).toString().padStart(2, "0");
  const minutes = Math.floor((remaining % 3_600_000) / 60_000).toString().padStart(2, "0");
  const seconds = Math.floor((remaining % 60_000) / 1000).toString().padStart(2, "0");
  async function choose(tier: (typeof tiers)[number]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigate({ to: "/auth", search: { redirect: "/done-for-you" } as never }); return; }
    // The Done-for-you tier is a business service, not a media-generation
    // shortcut. It must never route to the creator, including for admins.
    if (tier.name === "Done-for-you") { window.location.href = "mailto:hello@humancrush.com?subject=HumanCrush%20done-for-you%20business%20setup"; return; }
    const { data: admin } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (admin) { toast.success("Admin access enabled — no payment required."); navigate({ to: "/create-media" }); return; }
    navigate({ to: "/credits", search: { plan: tier.name === "Creator annual" ? "annual" : "monthly" } as never });
  }
  return <div className="min-h-screen bg-[#090812] text-white"><SiteHeader /><main className="relative overflow-hidden px-5 py-10 sm:py-16"><div className="pointer-events-none absolute left-1/2 top-0 -z-0 h-96 w-96 -translate-x-1/2 rounded-full bg-pink-500/20 blur-[120px]" /><div className="relative z-10 mx-auto max-w-6xl"><div className="grid items-center gap-10 lg:grid-cols-[1.1fr_.9fr]"><div><p className="text-xs font-bold uppercase tracking-[0.35em] text-pink-300">HumanCrush for business</p><h1 className="mt-4 max-w-3xl text-5xl font-black leading-[.95] tracking-tight sm:text-7xl">Turn one character into a real brand.</h1><p className="mt-6 max-w-xl text-lg leading-relaxed text-white/65">Use the studio yourself, or let us build the model, site, content engine, and launch system for you.</p></div><div className="rounded-[2rem] border border-pink-300/30 bg-gradient-to-br from-pink-500/20 to-violet-500/10 p-6 shadow-[0_0_60px_rgba(236,72,153,.15)]"><p className="text-xs font-bold uppercase tracking-widest text-pink-100">Limited launch window</p><p className="mt-4 font-mono text-5xl font-black">{hours}:{minutes}:{seconds}</p><p className="mt-2 text-sm text-white/60">The offer timer stays with this browser until it expires.</p></div></div><div className="mt-14 grid gap-5 md:grid-cols-3">{tiers.map((tier, index) => <article key={tier.name} className={`relative overflow-hidden rounded-[2rem] border p-6 ${tier.name === "Done-for-you" ? "border-pink-400/70 bg-gradient-to-b from-pink-500/20 to-[#171222]" : "border-white/10 bg-white/[0.05]"}`}><span className="text-xs font-bold text-white/40">0{index + 1}</span><p className="mt-6 text-sm font-semibold text-pink-200">{tier.name}</p><p className="mt-3 text-4xl font-black">{tier.price}</p><p className="mt-1 text-sm text-white/45">{tier.detail}</p><p className="mt-6 min-h-20 leading-relaxed text-white/65">{tier.copy}</p><Button className="mt-7 h-11 w-full" onClick={() => choose(tier)}>{tier.name === "Done-for-you" ? "Request a private call" : "Continue to checkout"}</Button></article>)}</div><section className="mt-12 rounded-[2rem] border border-white/10 bg-white/[0.04] p-7 sm:p-9"><div className="flex flex-col justify-between gap-5 sm:flex-row"><div><p className="text-xs font-bold uppercase tracking-widest text-pink-200">Done-for-you scope</p><h2 className="mt-2 text-2xl font-bold">Everything you need to launch.</h2></div><p className="max-w-md text-sm leading-relaxed text-white/50">One model, one focused brand, and a handoff you can actually operate.</p></div><div className="mt-7 grid gap-3 text-white/75 sm:grid-cols-2">{["One model identity and brand direction", "A dedicated model website", "Launch-ready image and video library", "Fanvue or OnlyFans setup guidance", "Facebook and Instagram setup guidance", "Handoff documentation and launch support"].map((item) => <p key={item} className="rounded-xl bg-black/20 px-4 py-3">✓ {item}</p>)}</div></section></div></main></div>;
}
