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

  async function handleEmail(event: React.FormEvent) {
    event.preventDefault(); setFormError(""); validateEmail(); validatePassword();
    if (!validEmail(email) || password.length < 6) return;
    if (mode === "signup") { if (!agreedAge) { setFormError("Confirm that you are 18 or older and agree to the Terms and Privacy Policy."); return; } await confirmSignup(); return; }
    setLoading(true);
    try { const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) throw error; goAfterAuth(); }
    catch (error) { setFormError((error as Error)?.message ?? "Could not sign in. Check your email and password."); }
    finally { setLoading(false); }
  }

  async function confirmSignup() {
    setLoading(true);
    try { const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } }); if (error) throw error; toast.success("Welcome. Check your email to confirm your account."); setMode("signin"); }
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
    try { const dest = redirect ?? (companion ? `/companion/${companion}` : "/browse"); const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}${dest}` } }); if (error) throw error; }
    catch (error) { setFormError((error as Error)?.message ?? "Google sign-in failed."); setLoading(false); }
  }

  const title = mode === "signin" ? "Welcome back" : "Create your account";
  const subtitle = mode === "signin" ? "Sign in to keep your chats, credits, and creator renders." : "Start with 25 free messages. No card needed.";
  const tileModels = authModels.length ? [...authModels, ...authModels] : [];

  return (
    <div className="min-h-screen bg-[#121014] text-[#F5EFF2] lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(380px,.9fr)]">
      <section aria-hidden="true" className="relative hidden min-h-[420px] overflow-hidden bg-[#0E0C10] lg:block">
        <div className="absolute inset-[-40px] grid grid-cols-3 gap-3 px-7 [transform:rotate(-4deg)]">{[0, 1, 2].map((column) => <div key={column} className="overflow-hidden"><div className="flex flex-col gap-3 animate-[hc-auth-drift_65s_linear_infinite]" style={{ animationDelay: `${column * -18}s` }}>{tileModels.slice(column * 4, column * 4 + 8).map((item, index) => <div key={`${item.id}-${column}-${index}`} className="relative h-[270px] overflow-hidden rounded-[18px] bg-[#26222A]"><img src={companionImage(item.image_url)} alt="" className="h-full w-full object-cover" /><span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0E0C10]/95 to-transparent p-3 text-xs text-[#EDE5EA]">{["rooftop portrait at golden hour", "soft bedroom morning light", "editorial city night", "poolside summer portrait"][index % 4]}</span></div>)}</div></div>)}</div>
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-[#121014]" />
        <div className="absolute bottom-10 left-10 right-10 max-w-[460px]"><p className="font-display text-[clamp(2rem,4vw,3.2rem)] font-extrabold leading-[1.04] tracking-[-.035em]">One face. Every scene you can describe.</p><p className="mt-3 text-[#B3A9B0]">Each render starts from your prompt. Keep a fictional adult identity consistent across your library.</p></div>
      </section>
      <main className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8 lg:min-h-0 lg:px-12">
        <div className="w-full max-w-[400px]">
          <LogoLink className="h-9" />
          <div className="mt-9"><h1 className="font-display text-4xl font-extrabold leading-tight tracking-[-.035em]">{title}</h1><p className="mt-2 text-sm text-[#B3A9B0]">{subtitle}</p></div>
          <div role="tablist" aria-label="Account" className="mt-7 flex rounded-full bg-white/[0.06] p-1"><button type="button" role="tab" aria-selected={mode === "signup"} onClick={() => { setMode("signup"); setFormError(""); }} className={`min-h-11 flex-1 rounded-full text-sm font-semibold ${mode === "signup" ? "bg-white text-[#121014]" : "text-[#B3A9B0]"}`}>Sign up</button><button type="button" role="tab" aria-selected={mode === "signin"} onClick={() => { setMode("signin"); setFormError(""); }} className={`min-h-11 flex-1 rounded-full text-sm font-semibold ${mode === "signin" ? "bg-white text-[#121014]" : "text-[#B3A9B0]"}`}>Log in</button></div>
          {googleEnabled && <><button type="button" onClick={() => void handleGoogle()} disabled={loading} className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-[#F5EFF2] text-sm font-semibold text-[#121014] disabled:opacity-50"><Sparkles className="h-4 w-4 text-[#4285F4]" /> Continue with Google</button><div className="my-5 flex items-center gap-3 text-xs text-[#8E858C]"><span className="h-px flex-1 bg-white/[0.1]" />or with email<span className="h-px flex-1 bg-white/[0.1]" /></div></>}
          {!googleEnabled && <div className="my-5 flex items-center gap-3 text-xs text-[#8E858C]"><span className="h-px flex-1 bg-white/[0.1]" />with email<span className="h-px flex-1 bg-white/[0.1]" /></div>}
          <form onSubmit={(event) => void handleEmail(event)} noValidate className="space-y-4">
            <div><label htmlFor="email" className="mb-2 block text-sm font-semibold">Email</label><input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} onBlur={validateEmail} placeholder="name@example.com" className="min-h-12 w-full rounded-[14px] border border-white/[0.12] bg-[#1C191E] px-4 text-sm outline-none transition focus:border-[#FF4D6A] focus:ring-2 focus:ring-[#FF4D6A]/30" />{emailError && <p className="mt-1 text-xs text-[#FF8C8C]">{emailError}</p>}</div>
            <div><div className="mb-2 flex items-center justify-between"><label htmlFor="password" className="text-sm font-semibold">Password</label>{mode === "signin" && <button type="button" onClick={() => void handleForgot()} className="text-xs text-[#FF7A90] hover:text-white">Forgot password?</button>}</div><div className="relative"><input id="password" type={showPw ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} onBlur={validatePassword} className="min-h-12 w-full rounded-[14px] border border-white/[0.12] bg-[#1C191E] px-4 pr-12 text-sm outline-none transition focus:border-[#FF4D6A] focus:ring-2 focus:ring-[#FF4D6A]/30" /><button type="button" aria-label={showPw ? "Hide password" : "Show password"} onClick={() => setShowPw((value) => !value)} className="absolute right-1 top-1 grid h-10 w-10 place-items-center rounded-full text-[#B3A9B0] hover:text-white">{showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>{passwordError && <p className="mt-1 text-xs text-[#FF8C8C]">{passwordError}</p>}</div>
            {mode === "signup" && <label className="flex items-start gap-3 text-xs leading-relaxed text-[#B3A9B0]"><input type="checkbox" checked={agreedAge} onChange={(event) => setAgreedAge(event.target.checked)} className="mt-1 h-4 w-4 accent-[#FF4D6A]" /><span>I am 18 or older and agree to the <Link to="/legal/$slug" params={{ slug: "terms" }} className="text-[#FF7A90] underline">Terms</Link> and <Link to="/legal/$slug" params={{ slug: "privacy" }} className="text-[#FF7A90] underline">Privacy Policy</Link>.</span></label>}
            {formError && <p role="alert" className="rounded-[14px] border border-[#FF8C8C]/30 bg-[#FF8C8C]/10 px-3 py-2 text-sm text-[#FF8C8C]">{formError}</p>}
            <button type="submit" disabled={loading || (mode === "signup" && !agreedAge)} className="min-h-12 w-full rounded-[14px] bg-[#FF4D6A] text-sm font-bold text-[#1A0A0F] transition hover:bg-[#FF7A90] disabled:cursor-not-allowed disabled:opacity-40">{loading ? "Please wait..." : mode === "signin" ? "Log in" : "Create account"}</button>
          </form>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-[#8E858C]"><button type="button" onClick={() => void handleResendConfirmation()} disabled={loading} className="hover:text-white">Resend verification</button><span aria-hidden="true">·</span><span>{mode === "signin" ? "New here?" : "Already have an account?"} <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="font-semibold text-[#FF7A90] hover:text-white">{mode === "signin" ? "Sign up" : "Log in"}</button></span></div>
        </div>
      </main>
      <style>{`@keyframes hc-auth-drift{from{transform:translateY(0)}to{transform:translateY(-50%)}}@media(prefers-reduced-motion:reduce){.animate-\\[hc-auth-drift_65s_linear_infinite\\]{animation:none!important}}`}</style>
    </div>
  );
}
