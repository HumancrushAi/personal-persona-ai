import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/done-for-you")({ ssr: false, component: DoneForYou });

const OFFER_KEY = "hc:business-offer-deadline";
const tiers = [
  { name: "Creator", price: "$29", detail: "Monthly", copy: "Generate images and videos with credits, using the standalone creator and your saved models." },
  { name: "Creator annual", price: "$249", detail: "Per year", copy: "The same creator workspace with a lower effective monthly price and a larger included credit balance." },
  { name: "Done-for-you", price: "Let's talk", detail: "Custom build", copy: "One complete model business: brand, model site, launch-ready image and video library, and social setup guidance." },
];

function DoneForYou() {
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
  return <div className="min-h-screen bg-[#0d0b12] text-white"><SiteHeader /><main className="mx-auto max-w-6xl px-5 py-14"><div className="mx-auto max-w-3xl text-center"><p className="text-sm font-semibold uppercase tracking-[0.25em] text-pink-300">HumanCrush for business</p><h1 className="mt-4 text-4xl font-black tracking-tight md:text-6xl">Launch your AI model business.</h1><p className="mx-auto mt-5 max-w-2xl text-lg text-white/65">Start with a credit-based creator workspace, or have our team build one polished model brand and launch system around your vision.</p><div className="mt-8 inline-flex items-center gap-3 rounded-2xl border border-pink-400/30 bg-pink-500/10 px-5 py-4"><span className="text-sm uppercase tracking-widest text-pink-200">Launch offer closes in</span><span className="font-mono text-2xl font-bold">{hours}:{minutes}:{seconds}</span></div></div><div className="mt-14 grid gap-5 md:grid-cols-3">{tiers.map((tier) => <article key={tier.name} className={`rounded-3xl border p-6 ${tier.name === "Done-for-you" ? "border-pink-400/60 bg-pink-500/10" : "border-white/10 bg-white/[0.04]"}`}><p className="text-sm font-semibold text-pink-200">{tier.name}</p><p className="mt-5 text-4xl font-black">{tier.price}</p><p className="mt-1 text-sm text-white/45">{tier.detail}</p><p className="mt-5 min-h-20 text-white/65">{tier.copy}</p><Button className="mt-6 w-full" onClick={() => { window.location.href = "mailto:hello@humancrush.com?subject=HumanCrush%20business%20setup"; }}>{tier.name === "Done-for-you" ? "Request a private call" : "Get started"}</Button></article>)}</div><section className="mx-auto mt-14 max-w-3xl rounded-3xl border border-white/10 bg-white/[0.03] p-7"><h2 className="text-2xl font-bold">What the private build includes</h2><div className="mt-5 grid gap-3 text-white/70 sm:grid-cols-2">{["One model identity and brand direction", "A dedicated model website", "A launch-ready image and video library", "Fanvue or OnlyFans setup guidance", "Facebook and Instagram account setup guidance", "Handoff documentation and launch support"].map((item) => <p key={item}>✓ {item}</p>)}</div><p className="mt-6 text-sm text-white/45">Account ownership, platform verification, payment accounts, and publishing remain with the client. We provide setup and creative production, not impersonation or platform bypasses.</p></section></main></div>;
}
