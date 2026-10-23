import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Eye, EyeOff, Sparkles } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { companionImage } from "@/lib/companion-images";
import { orderModelsForDisplay } from "@/lib/display-models";
import { toast } from "sonner";
import { LogoLink } from "@/components/Logo";
import { goBackOrExplore } from "@/lib/back-navigation";

const authSearchSchema = z.object({ companion: z.string().optional(), redirect: z.string().optional(), mode: z.enum(["signin", "signup"]).optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: (search) => authSearchSchema.parse(search),
  head: () => ({ meta: [{ title: "Sign in | HumanCrush" }] }),
  component: AuthPage,
});

type AuthModel = { id: string; name: string; image_url: string; gender?: string | null };

// The authentication gallery is a storefront, not a catalog. Lead with the
// fashion-forward, younger-looking identities; keep the established large-bust
// and male models available, but never let them become the default first view.
const AUTH_LEAD_NAMES = ["Raven", "Skye", "Aria", "Sofia", "Kira", "Harley", "Vex", "Jett", "Chloe", "Ravenna", "Lilith", "Putri", "Airi", "Mina", "Naomi", "Hana"];
const AUTH_TRAILING_NAMES = ["Vanessa", "Sabrina", "Bianca", "Scarlett", "Ruby", "Lola", "Monica", "Diane", "Keisha", "Carmen"];
function authModelRank(model: AuthModel) {
  const name = model.name.trim().toLowerCase();
  const preferred = AUTH_LEAD_NAMES.findIndex((item) => item.toLowerCase() === name);
  if (preferred >= 0) return preferred;
  if (AUTH_TRAILING_NAMES.some((item) => item.toLowerCase() === name)) return 800;
  if (/male|trans-male/i.test(model.gender ?? "")) return 900;
  return 100 + name.charCodeAt(0);
}

function AuthPage() {
  const navigate = useNavigate();
  const { companion, redirect, mode: modeParam } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">(modeParam ?? "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [agreedAge, setAgreedAge] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [formError, setFormError] = useState("");
  const [authModels, setAuthModels] = useState<AuthModel[]>([]);
  const googleEnabled = import.meta.env.VITE_ENABLE_GOOGLE_AUTH === "true";

  useEffect(() => {
    supabase.from("companions").select("id,name,image_url,gender").order("sort_order").then(({ data }) => setAuthModels((data ?? []) as AuthModel[]));
  }, []);

  const galleryModels = useMemo(() => orderModelsForDisplay(authModels).slice(0, 12), [authModels]);
  const tileModels = galleryModels.length ? [...galleryModels, ...galleryModels] : [];
  const goAfterAuth = () => {
    if (redirect) navigate({ to: redirect as never });
    else if (companion) navigate({ to: "/companion/$id", params: { id: companion } });
    else navigate({ to: "/browse" });
  };
  const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const validateEmail = () => setEmailError(email && !validEmail(email) ? "Enter an email like name@example.com." : "");
  const validatePassword = () => setPasswordError(password && password.length < 6 ? "Use at least 6 characters." : "");
  const selectMode = (nextMode: "signin" | "signup") => { setMode(nextMode); setFormError(""); };

  async function handleEmail(event: React.FormEvent) {
    event.preventDefault(); setFormError(""); validateEmail(); validatePassword();
    if (!validEmail(email) || password.length < 6) return;
    if (mode === "signup") {
      if (!agreedAge) { setFormError("Confirm that you are 18 or older and agree to the Terms and Privacy Policy."); return; }
      await confirmSignup();
      return;
    }
    setLoading(true);
    try { const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) throw error; goAfterAuth(); }
    catch (error) { setFormError((error as Error)?.message ?? "Could not sign in. Check your email and password."); }
    finally { setLoading(false); }
  }

  async function confirmSignup() {
    setLoading(true);
    try { const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } }); if (error) throw error; toast.success("Welcome. Check your email to confirm your account."); selectMode("signin"); }
    catch (error) { setFormError((error as Error)?.message ?? "Could not create your account."); }
    finally { setLoading(false); }
  }

  async function handleForgot() {
    if (!validEmail(email)) { setEmailError("Enter an email like name@example.com."); return; }
    setLoading(true);
    try { const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` }); if (error) throw error; toast.success("Password reset link sent. Check your email."); }
    catch (error) { setFormError((error as Error)?.message ?? "Could not send the reset email."); }
    finally { setLoading(false); }
  }

  async function handleResendConfirmation() {
    if (!validEmail(email)) { setEmailError("Enter an email like name@example.com."); return; }
    setLoading(true);
    try { const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: window.location.origin } }); if (error) throw error; toast.success("Verification link resent. Check your email."); }
    catch (error) { setFormError((error as Error)?.message ?? "Could not resend the verification email."); }
    finally { setLoading(false); }
  }

  async function handleGoogle() {
    setLoading(true); setFormError("");
    try { const destination = redirect ?? (companion ? `/companion/${companion}` : "/browse"); const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}${destination}` } }); if (error) throw error; }
    catch (error) { setFormError((error as Error)?.message ?? "Google sign-in failed."); setLoading(false); }
  }

  const title = mode === "signin" ? "Welcome back" : "Create your account";
  const subtitle = mode === "signin" ? "Sign in to keep your chats, credits, and creator renders." : "Start with 25 free messages. No card needed.";

  return (
    <div className="min-h-screen bg-[#121014] text-[#F5EFF2] lg:flex">
      <button type="button" aria-label="Back" onClick={() => goBackOrExplore()} className="fixed left-4 top-4 z-20 grid h-11 w-11 place-items-center rounded-full border border-white/[0.16] bg-[#121014]/85 text-white backdrop-blur transition hover:bg-white/[0.1] sm:left-6 sm:top-6"><ArrowLeft className="h-5 w-5" /></button>
      <section aria-hidden="true" className="relative min-h-[340px] flex-[1_1_520px] overflow-hidden bg-[#0E0C10] sm:min-h-[420px]">
        <div className="absolute inset-[-40px] grid grid-cols-3 gap-3 px-5 [transform:rotate(-4deg)] sm:gap-3.5 sm:px-7">
          {[0, 1, 2].map((column) => <div key={column} className="overflow-hidden"><div className="flex flex-col gap-3 animate-[hc-auth-drift_65s_linear_infinite] sm:gap-3.5" style={{ animationDelay: `${column * -18}s`, animationDuration: `${58 + column * 9}s` }}>{tileModels.slice(column * 4, column * 4 + 8).map((item, index) => <figure key={`${item.id}-${column}-${index}`} className="relative m-0 h-[190px] overflow-hidden rounded-[16px] bg-[#26222A] sm:h-[290px] sm:rounded-[18px]"><img src={companionImage(item.image_url)} alt="" className="h-full w-full object-cover object-top" /><figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0E0C10]/95 to-transparent p-3 pt-10 text-[10px] text-[#EDE5EA] sm:text-xs">{["Rooftop at golden hour", "Soft bedroom light", "Editorial city night", "Poolside portrait"][index % 4]}</figcaption></figure>)}</div></div>)}
        </div>
        <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_45%,#121014_100%),linear-gradient(0deg,rgba(14,12,16,.9)_0%,transparent_45%)]" />
        <div className="absolute bottom-6 left-6 right-6 max-w-[460px] sm:bottom-10 sm:left-10 sm:right-10"><p className="font-display text-[clamp(1.8rem,5vw,3.2rem)] font-extrabold leading-[1.04] tracking-[-.03em]">One face. Every scene you can describe.</p><p className="mt-3 max-w-md text-sm leading-relaxed text-[#B3A9B0] sm:text-base">Each tile begins with a prompt. Keep a fictional adult identity consistent across your library.</p></div>
      </section>
      <main className="flex min-h-[620px] flex-[1_1_440px] items-center justify-center px-5 py-10 sm:px-8 lg:min-h-screen lg:px-12">
        <div className="flex w-full max-w-[400px] flex-col gap-6">
          <LogoLink className="h-9" />
          <div><h1 className="font-display text-[2.15rem] font-extrabold leading-[1.08] tracking-[-.035em]">{title}</h1><p className="mt-2 text-sm leading-relaxed text-[#B3A9B0]">{subtitle}</p></div>
          <div role="tablist" aria-label="Account" className="grid grid-cols-2 rounded-full bg-white/[0.06] p-1"><button type="button" role="tab" aria-selected={mode === "signup"} onClick={() => selectMode("signup")} className={`min-h-10 rounded-full text-sm font-semibold ${mode === "signup" ? "bg-[#F5EFF2] text-[#121014]" : "text-[#B3A9B0]"}`}>Sign up</button><button type="button" role="tab" aria-selected={mode === "signin"} onClick={() => selectMode("signin")} className={`min-h-10 rounded-full text-sm font-semibold ${mode === "signin" ? "bg-[#F5EFF2] text-[#121014]" : "text-[#B3A9B0]"}`}>Log in</button></div>
          {googleEnabled && <><button type="button" onClick={() => void handleGoogle()} disabled={loading} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-[#F5EFF2] text-sm font-semibold text-[#121014] disabled:opacity-50"><Sparkles className="h-4 w-4 text-[#4285F4]" />Continue with Google</button><div className="flex items-center gap-3 text-xs text-[#8E858C]"><span className="h-px flex-1 bg-white/[0.1]" />or with email<span className="h-px flex-1 bg-white/[0.1]" /></div></>}
          {!googleEnabled && <div className="flex items-center gap-3 text-xs text-[#8E858C]"><span className="h-px flex-1 bg-white/[0.1]" />with email<span className="h-px flex-1 bg-white/[0.1]" /></div>}
          <form onSubmit={(event) => void handleEmail(event)} noValidate className="space-y-4">
            <div><label htmlFor="email" className="mb-2 block text-sm font-semibold">Email</label><input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} onBlur={validateEmail} placeholder="name@example.com" className="min-h-12 w-full rounded-[14px] border border-white/[0.12] bg-[#1C191E] px-4 text-sm outline-none transition focus:border-[#FF4D6A] focus:ring-2 focus:ring-[#FF4D6A]/30" />{emailError && <p className="mt-1 text-xs text-[#FF8C8C]">{emailError}</p>}</div>
            <div><div className="mb-2 flex items-center justify-between"><label htmlFor="password" className="text-sm font-semibold">Password</label>{mode === "signin" && <button type="button" onClick={() => void handleForgot()} className="text-xs text-[#FF7A90] hover:text-white">Forgot password?</button>}</div><div className="relative"><input id="password" type={showPw ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} onBlur={validatePassword} placeholder={mode === "signup" ? "At least 6 characters" : "Your password"} className="min-h-12 w-full rounded-[14px] border border-white/[0.12] bg-[#1C191E] px-4 pr-12 text-sm outline-none transition focus:border-[#FF4D6A] focus:ring-2 focus:ring-[#FF4D6A]/30" /><button type="button" aria-label={showPw ? "Hide password" : "Show password"} onClick={() => setShowPw((value) => !value)} className="absolute right-1 top-1 grid h-10 w-10 place-items-center rounded-full text-[#B3A9B0] hover:text-white">{showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>{passwordError && <p className="mt-1 text-xs text-[#FF8C8C]">{passwordError}</p>}</div>
            {mode === "signup" && <label className="flex items-start gap-3 text-xs leading-relaxed text-[#B3A9B0]"><input type="checkbox" checked={agreedAge} onChange={(event) => setAgreedAge(event.target.checked)} className="mt-1 h-4 w-4 accent-[#FF4D6A]" /><span>I am 18 or older and agree to the <Link to="/legal/$slug" params={{ slug: "terms" }} className="text-[#FF7A90] underline">Terms</Link> and <Link to="/legal/$slug" params={{ slug: "privacy" }} className="text-[#FF7A90] underline">Privacy Policy</Link>.</span></label>}
            {formError && <p role="alert" className="rounded-[14px] border border-[#FF8C8C]/30 bg-[#FF8C8C]/10 px-3 py-2 text-sm text-[#FF8C8C]">{formError}</p>}
            <button type="submit" disabled={loading || (mode === "signup" && !agreedAge)} className="min-h-12 w-full rounded-[14px] bg-[#FF4D6A] text-sm font-bold text-[#1A0A0F] transition hover:bg-[#FF7A90] disabled:cursor-not-allowed disabled:opacity-40">{loading ? "Please wait..." : mode === "signin" ? "Log in" : "Create account"}</button>
          </form>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-[#8E858C]"><button type="button" onClick={() => void handleResendConfirmation()} disabled={loading} className="hover:text-white">Resend verification</button><span aria-hidden="true">&bull;</span><span>{mode === "signin" ? "New here?" : "Already have an account?"} <button type="button" onClick={() => selectMode(mode === "signin" ? "signup" : "signin")} className="font-semibold text-[#FF7A90] hover:text-white">{mode === "signin" ? "Sign up" : "Log in"}</button></span></div>
          <p className="text-center text-[11px] leading-relaxed text-[#8E858C]">All HumanCrush characters are fictional, AI-generated adults.</p>
        </div>
      </main>
      <style>{`@keyframes hc-auth-drift{from{transform:translateY(0)}to{transform:translateY(-50%)}}@media(prefers-reduced-motion:reduce){.animate-\\[hc-auth-drift_65s_linear_infinite\\]{animation:none!important}}`}</style>
    </div>
  );
}
