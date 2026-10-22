import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Sparkles } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { companionImage } from "@/lib/companion-images";
import { toast } from "sonner";
import { LogoLink } from "@/components/Logo";

const authSearchSchema = z.object({ companion: z.string().optional(), redirect: z.string().optional(), mode: z.enum(["signin", "signup"]).optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: (search) => authSearchSchema.parse(search),
  head: () => ({ meta: [{ title: "Sign in | HumanCrush" }] }),
  component: AuthPage,
});

type AuthModel = { id: string; name: string; image_url: string };

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
    supabase.from("companions").select("id,name,image_url").order("sort_order").limit(12).then(({ data }) => setAuthModels((data ?? []) as AuthModel[]));
  }, []);

  const goAfterAuth = () => {
    if (redirect) navigate({ to: redirect as never });
    else if (companion) navigate({ to: "/companion/$id", params: { id: companion } });
    else navigate({ to: "/browse" });
  };
  const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const validateEmail = () => setEmailError(email && !validEmail(email) ? "Enter an email like name@example.com." : "");
  const validatePassword = () => setPasswordError(password && password.length < 6 ? "Use at least 6 characters." : "");
  const pickMode = (nextMode: "signin" | "signup") => { setMode(nextMode); setFormError(""); };

  async function handleEmail(event: React.FormEvent) {
    event.preventDefault(); setFormError(""); validateEmail(); validatePassword();
    if (!validEmail(email) || password.length < 6) return;
    if (mode === "signup") {
      if (!agreedAge) { setFormError("Confirm that you are 18 or older and agree to the Terms and Privacy Policy."); return; }
      await confirmSignup();
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      goAfterAuth();
    } catch (error) {
      setFormError((error as Error)?.message ?? "Could not sign in. Check your email and password.");
    } finally { setLoading(false); }
  }

  async function confirmSignup() {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
      if (error) throw error;
      toast.success("Welcome. Check your email to confirm your account.");
      pickMode("signin");
    } catch (error) {
      setFormError((error as Error)?.message ?? "Could not create your account.");
    } finally { setLoading(false); }
  }

  async function handleForgot() {
    if (!validEmail(email)) { setEmailError("Enter an email like name@example.com."); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
      if (error) throw error;
      toast.success("Password reset link sent. Check your email.");
    } catch (error) {
      setFormError((error as Error)?.message ?? "Could not send the reset email.");
    } finally { setLoading(false); }
  }

  async function handleResendConfirmation() {
    if (!validEmail(email)) { setEmailError("Enter an email like name@example.com."); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: window.location.origin } });
      if (error) throw error;
      toast.success("Verification link resent. Check your email.");
    } catch (error) {
      setFormError((error as Error)?.message ?? "Could not resend the verification email.");
    } finally { setLoading(false); }
  }

  async function handleGoogle() {
    setLoading(true); setFormError("");
    try {
      const destination = redirect ?? (companion ? `/companion/${companion}` : "/browse");
      const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}${destination}` } });
      if (error) throw error;
    } catch (error) {
      setFormError((error as Error)?.message ?? "Google sign-in failed.");
      setLoading(false);
    }
  }

  const title = mode === "signin" ? "Welcome back." : "Make it yours.";
  const subtitle = mode === "signin" ? "Your chats, credits, and saved renders are waiting." : "Build a private library of fictional adult characters and scenes.";
  const desktopTiles = authModels.length ? [...authModels, ...authModels] : [];
  const mobileTiles = authModels.slice(0, 3);

  return (
    <div className="min-h-screen bg-[#111112] p-0 text-[#F6F4F2] lg:p-4">
      <div className="mx-auto grid min-h-screen max-w-[1680px] overflow-hidden bg-[#171719] lg:min-h-[calc(100vh-2rem)] lg:grid-cols-[minmax(0,1.18fr)_minmax(440px,.82fr)] lg:rounded-[30px] lg:border lg:border-white/[0.08]">
        <section aria-hidden="true" className="relative hidden min-h-[600px] overflow-hidden bg-[#0D0D0E] lg:block">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(255,89,126,.2),transparent_28%),radial-gradient(circle_at_82%_80%,rgba(159,84,255,.16),transparent_32%)]" />
          <div className="absolute inset-[-10%] grid grid-cols-3 gap-3 px-9 [transform:rotate(-5deg)_scale(1.08)]">
            {[0, 1, 2].map((column) => (
              <div key={column} className="overflow-hidden">
                <div className="flex flex-col gap-3 animate-[hc-auth-drift_62s_linear_infinite]" style={{ animationDelay: `${column * -16}s`, animationDuration: `${58 + column * 8}s` }}>
                  {desktopTiles.slice(column * 4, column * 4 + 8).map((item, index) => (
                    <figure key={`${item.id}-${column}-${index}`} className="relative m-0 h-[290px] overflow-hidden rounded-[22px] border border-white/[0.08] bg-[#242427] shadow-2xl">
                      <img src={companionImage(item.image_url)} alt="" className="h-full w-full object-cover object-top opacity-90" />
                      <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent px-4 pb-3 pt-11 text-xs font-semibold tracking-wide text-white">{item.name}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(13,13,14,.08)_26%,rgba(13,13,14,.78)_90%),linear-gradient(0deg,rgba(13,13,14,.98)_0%,transparent_45%)]" />
          <div className="absolute bottom-12 left-12 right-12 max-w-[540px]"><p className="text-xs font-bold uppercase tracking-[.24em] text-[#FF7A90]">HumanCrush studio</p><h2 className="mt-4 font-display text-5xl font-extrabold leading-[.96] tracking-[-.055em]">One identity.<br />Every scene.</h2><p className="mt-5 max-w-md text-base leading-relaxed text-[#B9B5B7]">Use a character consistently across your private chats and creator library.</p></div>
        </section>

        <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#171719] px-5 py-8 sm:px-8 lg:min-h-0 lg:px-12">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_90%_5%,rgba(255,83,125,.11),transparent_25%)]" />
          <div className="relative w-full max-w-[430px]">
            <div className="lg:hidden"><LogoLink className="h-8" /><div className="mt-7 grid grid-cols-3 gap-2 overflow-hidden rounded-[20px] border border-white/[0.08] bg-black/30 p-2">{mobileTiles.length > 0 ? mobileTiles.map((model) => <div key={model.id} className="relative aspect-[3/4] overflow-hidden rounded-xl bg-[#252529]"><img src={companionImage(model.image_url)} alt="" className="h-full w-full object-cover object-top" /></div>) : <><div className="aspect-[3/4] rounded-xl bg-[#29262C]" /><div className="aspect-[3/4] rounded-xl bg-[#242428]" /><div className="aspect-[3/4] rounded-xl bg-[#30242B]" /></>}</div></div>
            <div className="hidden lg:block"><LogoLink className="h-9" /></div>
            <div className="mt-8 rounded-[28px] border border-white/[0.1] bg-[#1D1D20] p-5 shadow-[0_28px_80px_rgba(0,0,0,.32)] sm:p-8">
              <p className="text-[10px] font-bold uppercase tracking-[.22em] text-[#FF7A90]">Your private studio</p>
              <h1 className="mt-3 font-display text-[2.25rem] font-extrabold leading-[.98] tracking-[-.05em] sm:text-5xl">{title}</h1>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-[#AFAAAD]">{subtitle}</p>

              <div role="tablist" aria-label="Account" className="mt-7 grid grid-cols-2 rounded-2xl border border-white/[0.08] bg-black/25 p-1.5">
                <button type="button" role="tab" aria-selected={mode === "signup"} onClick={() => pickMode("signup")} className={`min-h-11 rounded-xl text-sm font-bold transition ${mode === "signup" ? "bg-white text-[#111112] shadow-sm" : "text-[#AAA5A8] hover:text-white"}`}>Sign up</button>
                <button type="button" role="tab" aria-selected={mode === "signin"} onClick={() => pickMode("signin")} className={`min-h-11 rounded-xl text-sm font-bold transition ${mode === "signin" ? "bg-white text-[#111112] shadow-sm" : "text-[#AAA5A8] hover:text-white"}`}>Log in</button>
              </div>

              {googleEnabled && <><button type="button" onClick={() => void handleGoogle()} disabled={loading} className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.12] bg-white text-sm font-bold text-[#151517] transition hover:bg-[#F0EDEE] disabled:opacity-50"><Sparkles className="h-4 w-4 text-[#FF4D6A]" /> Continue with Google</button><div className="my-5 flex items-center gap-3 text-[11px] font-medium uppercase tracking-[.13em] text-[#7F7A7D]"><span className="h-px flex-1 bg-white/[0.1]" />or use email<span className="h-px flex-1 bg-white/[0.1]" /></div></>}
              {!googleEnabled && <div className="my-6 flex items-center gap-3 text-[11px] font-medium uppercase tracking-[.13em] text-[#7F7A7D]"><span className="h-px flex-1 bg-white/[0.1]" />continue with email<span className="h-px flex-1 bg-white/[0.1]" /></div>}

              <form onSubmit={(event) => void handleEmail(event)} noValidate className="space-y-4">
                <div><label htmlFor="email" className="mb-2 block text-sm font-semibold text-[#ECE8E9]">Email address</label><input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} onBlur={validateEmail} placeholder="name@example.com" className="min-h-12 w-full rounded-xl border border-white/[0.12] bg-[#121214] px-4 text-sm text-white outline-none transition placeholder:text-[#777276] focus:border-[#FF6B8A] focus:ring-2 focus:ring-[#FF6B8A]/20" />{emailError && <p className="mt-1.5 text-xs text-[#FF9DAE]">{emailError}</p>}</div>
                <div><div className="mb-2 flex items-center justify-between"><label htmlFor="password" className="text-sm font-semibold text-[#ECE8E9]">Password</label>{mode === "signin" && <button type="button" onClick={() => void handleForgot()} className="text-xs font-semibold text-[#FF8CA2] hover:text-white">Forgot password?</button>}</div><div className="relative"><input id="password" type={showPw ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} onBlur={validatePassword} placeholder={mode === "signup" ? "At least 6 characters" : "Your password"} className="min-h-12 w-full rounded-xl border border-white/[0.12] bg-[#121214] px-4 pr-12 text-sm text-white outline-none transition placeholder:text-[#777276] focus:border-[#FF6B8A] focus:ring-2 focus:ring-[#FF6B8A]/20" /><button type="button" aria-label={showPw ? "Hide password" : "Show password"} onClick={() => setShowPw((value) => !value)} className="absolute right-1 top-1 grid h-10 w-10 place-items-center rounded-lg text-[#A39EA2] hover:bg-white/[0.06] hover:text-white">{showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>{passwordError && <p className="mt-1.5 text-xs text-[#FF9DAE]">{passwordError}</p>}</div>
                {mode === "signup" && <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.07] bg-black/15 p-3 text-xs leading-relaxed text-[#B7B2B5]"><input type="checkbox" checked={agreedAge} onChange={(event) => setAgreedAge(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#FF5A7A]" /><span>I confirm I am 18 or older and agree to the <Link to="/legal/$slug" params={{ slug: "terms" }} className="font-semibold text-[#FF91A5] hover:text-white">Terms</Link> and <Link to="/legal/$slug" params={{ slug: "privacy" }} className="font-semibold text-[#FF91A5] hover:text-white">Privacy Policy</Link>.</span></label>}
                {formError && <p role="alert" className="rounded-xl border border-[#FF9DAE]/25 bg-[#FF9DAE]/10 px-3 py-2.5 text-sm text-[#FFB0BC]">{formError}</p>}
                <button type="submit" disabled={loading || (mode === "signup" && !agreedAge)} className="min-h-12 w-full rounded-xl bg-[linear-gradient(100deg,#FF4F70,#EC6C96_52%,#B04DFF)] px-4 text-sm font-extrabold text-white shadow-[0_12px_28px_rgba(255,79,112,.22)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">{loading ? "Please wait…" : mode === "signin" ? "Log in to HumanCrush" : "Create your account"}</button>
              </form>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs text-[#908A8E]"><button type="button" onClick={() => void handleResendConfirmation()} disabled={loading} className="hover:text-white">Resend verification</button><span aria-hidden="true">•</span><span>{mode === "signin" ? "New here?" : "Already have an account?"} <button type="button" onClick={() => pickMode(mode === "signin" ? "signup" : "signin")} className="font-bold text-[#FF91A5] hover:text-white">{mode === "signin" ? "Sign up" : "Log in"}</button></span></div>
            </div>
            <p className="mx-auto mt-5 max-w-sm text-center text-[11px] leading-relaxed text-[#777276]">All HumanCrush characters are fictional, AI-generated adults. Your account and saved renders remain private.</p>
          </div>
        </main>
      </div>
      <style>{`@keyframes hc-auth-drift{from{transform:translateY(0)}to{transform:translateY(-50%)}}@media(prefers-reduced-motion:reduce){.animate-\\[hc-auth-drift_62s_linear_infinite\\]{animation:none!important}}`}</style>
    </div>
  );
}
