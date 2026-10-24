import { Link } from "@tanstack/react-router";
import { Eye, EyeOff, MailCheck, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { authProviderFeatures } from "@/config/auth-providers";

export type AuthScreen = "signup" | "signin" | "forgot" | "check-email";
type CheckEmailPurpose = "signup" | "reset";

type AuthFormProps = {
  initialScreen?: Extract<AuthScreen, "signup" | "signin">;
  redirectPath?: string;
  companionId?: string;
  onAuthenticated: () => void;
  onCancel?: () => void;
  compact?: boolean;
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Presentation-only auth flow. Every request deliberately uses the existing
 * Supabase client and provider configuration; callers choose where to resume
 * once a successful session has been established.
 */
export function AuthForm({
  initialScreen = "signup",
  redirectPath,
  companionId,
  onAuthenticated,
  onCancel,
  compact = false,
}: AuthFormProps) {
  const [screen, setScreen] = useState<AuthScreen>(initialScreen);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [checkEmailPurpose, setCheckEmailPurpose] = useState<CheckEmailPurpose>("signup");
  const googleEnabled = authProviderFeatures.google;

  const destination = redirectPath ?? (companionId ? `/companion/${companionId}` : "/browse");
  const surfaceClass = compact ? "space-y-3" : "space-y-4";

  function moveTo(next: AuthScreen) {
    setScreen(next);
    setError("");
    setEmailError("");
    setPasswordError("");
  }

  function validateEmail() {
    const nextError = email && !isValidEmail(email) ? "Enter an email like name@example.com." : "";
    setEmailError(nextError);
    return !nextError && isValidEmail(email);
  }

  function validatePassword() {
    const nextError = password && password.length < 6 ? "Use at least 6 characters." : "";
    setPasswordError(nextError);
    return !nextError && password.length >= 6;
  }

  async function signIn() {
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;
    onAuthenticated();
  }

  async function signUp() {
    if (!ageConfirmed) {
      setError("Confirm that you are 18 or older and agree to the Terms and Privacy Policy.");
      return;
    }
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (signUpError) throw signUpError;
    setCheckEmailPurpose("signup");
    moveTo("check-email");
  }

  async function submitCredentials(event: FormEvent) {
    event.preventDefault();
    setError("");
    const emailIsValid = validateEmail();
    const passwordIsValid = validatePassword();
    if (!emailIsValid || !passwordIsValid) return;
    setLoading(true);
    try {
      if (screen === "signup") await signUp();
      else await signIn();
    } catch (requestError) {
      setError((requestError as Error)?.message ?? "We could not complete that request. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function sendPasswordReset(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!validateEmail()) return;
    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) throw resetError;
      setCheckEmailPurpose("reset");
      moveTo("check-email");
    } catch (requestError) {
      setError((requestError as Error)?.message ?? "We could not send the reset email.");
    } finally {
      setLoading(false);
    }
  }

  async function resendEmail(purpose: CheckEmailPurpose) {
    setError("");
    if (!isValidEmail(email)) {
      setEmailError("Enter your account email first.");
      return;
    }
    setLoading(true);
    try {
      if (purpose === "signup") {
        const { error: resendError } = await supabase.auth.resend({
          type: "signup",
          email,
          options: { emailRedirectTo: window.location.origin },
        });
        if (resendError) throw resendError;
      } else {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (resetError) throw resetError;
      }
      toast.success("Email sent. Check your inbox.");
      setCheckEmailPurpose(purpose);
      if (screen !== "check-email") moveTo("check-email");
    } catch (requestError) {
      setError((requestError as Error)?.message ?? "We could not resend that email.");
    } finally {
      setLoading(false);
    }
  }

  async function continueWithGoogle() {
    setError("");
    setLoading(true);
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}${destination}` },
      });
      if (oauthError) throw oauthError;
    } catch (requestError) {
      setError((requestError as Error)?.message ?? "Google sign-in failed.");
      setLoading(false);
    }
  }

  if (screen === "check-email") {
    const isReset = checkEmailPurpose === "reset";
    return <section aria-labelledby="check-email-title" className={surfaceClass}>
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.08] text-white"><MailCheck className="h-6 w-6" /></div>
      <div><h1 id="check-email-title" className="font-display text-3xl font-extrabold tracking-[-.035em] text-white">Check your email</h1><p className="mt-2 text-sm leading-relaxed text-[#A1A1AA]">{isReset ? "We sent a password reset link" : "We sent a confirmation link"} to <span className="font-semibold text-white">{email}</span>.</p></div>
      {error && <p role="alert" className="rounded-xl border border-[#F87171]/30 bg-[#F87171]/10 px-3 py-2 text-sm text-[#FCA5A5]">{error}</p>}
      <button type="button" onClick={() => void resendEmail(checkEmailPurpose)} disabled={loading} className="min-h-12 w-full rounded-xl bg-white text-sm font-bold text-[#111113] transition hover:bg-[#E4E4E7] disabled:opacity-50">{loading ? "Sending…" : "Resend email"}</button>
      <button type="button" onClick={() => moveTo("signin")} className="min-h-11 w-full rounded-xl border border-white/[0.14] text-sm font-semibold text-white hover:bg-white/[0.06]">Back to log in</button>
      {onCancel && <button type="button" onClick={onCancel} className="w-full text-xs text-[#A1A1AA] hover:text-white">Cancel</button>}
    </section>;
  }

  if (screen === "forgot") {
    return <section aria-labelledby="forgot-password-title" className={surfaceClass}>
      <div><h1 id="forgot-password-title" className="font-display text-3xl font-extrabold tracking-[-.035em] text-white">Reset your password</h1><p className="mt-2 text-sm leading-relaxed text-[#A1A1AA]">Enter your account email and we’ll send a reset link.</p></div>
      <form onSubmit={(event) => void sendPasswordReset(event)} noValidate className={surfaceClass}>
        <div><label htmlFor="reset-email" className="mb-2 block text-sm font-semibold text-white">Email</label><input id="reset-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} onBlur={validateEmail} placeholder="name@example.com" className="min-h-12 w-full rounded-xl border border-white/[0.12] bg-white/[0.04] px-4 text-sm text-white outline-none transition placeholder:text-[#71717A] focus:border-white/50 focus:ring-2 focus:ring-white/10" />{emailError && <p className="mt-1 text-xs text-[#FCA5A5]">{emailError}</p>}</div>
        {error && <p role="alert" className="rounded-xl border border-[#F87171]/30 bg-[#F87171]/10 px-3 py-2 text-sm text-[#FCA5A5]">{error}</p>}
        <button type="submit" disabled={loading} className="min-h-12 w-full rounded-xl bg-white text-sm font-bold text-[#111113] transition hover:bg-[#E4E4E7] disabled:opacity-50">{loading ? "Sending…" : "Send reset link"}</button>
      </form>
      <button type="button" onClick={() => moveTo("signin")} className="min-h-11 w-full rounded-xl border border-white/[0.14] text-sm font-semibold text-white hover:bg-white/[0.06]">Back to log in</button>
    </section>;
  }

  const isSignup = screen === "signup";
  return <section aria-labelledby="auth-title" className={surfaceClass}>
    <div><p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#A1A1AA]">HumanCrush account</p><h1 id="auth-title" className="mt-2 font-display text-3xl font-extrabold tracking-[-.035em] text-white">{isSignup ? "Create your account" : "Welcome back"}</h1><p className="mt-2 text-sm leading-relaxed text-[#A1A1AA]">{isSignup ? "Save your models, renders, and credit balance in one place." : "Sign in to return to your saved models and renders."}</p></div>
    <div role="tablist" aria-label="Account" className="grid grid-cols-2 rounded-xl border border-white/[0.1] bg-black/20 p-1"><button type="button" role="tab" aria-selected={isSignup} onClick={() => moveTo("signup")} className={`min-h-11 rounded-lg text-sm font-semibold transition ${isSignup ? "bg-white text-[#111113]" : "text-[#A1A1AA] hover:text-white"}`}>Sign up</button><button type="button" role="tab" aria-selected={!isSignup} onClick={() => moveTo("signin")} className={`min-h-11 rounded-lg text-sm font-semibold transition ${!isSignup ? "bg-white text-[#111113]" : "text-[#A1A1AA] hover:text-white"}`}>Log in</button></div>
    {googleEnabled && <><button type="button" onClick={() => void continueWithGoogle()} disabled={loading} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.14] bg-white text-sm font-semibold text-[#111113] transition hover:bg-[#E4E4E7] disabled:opacity-50"><Sparkles className="h-4 w-4" />Continue with Google</button><div className="flex items-center gap-3 text-xs text-[#71717A]"><span className="h-px flex-1 bg-white/[0.1]" />or use email<span className="h-px flex-1 bg-white/[0.1]" /></div></>}
    <form onSubmit={(event) => void submitCredentials(event)} noValidate className={surfaceClass}>
      <div><label htmlFor="auth-email" className="mb-2 block text-sm font-semibold text-white">Email</label><input id="auth-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} onBlur={validateEmail} placeholder="name@example.com" className="min-h-12 w-full rounded-xl border border-white/[0.12] bg-white/[0.04] px-4 text-sm text-white outline-none transition placeholder:text-[#71717A] focus:border-white/50 focus:ring-2 focus:ring-white/10" />{emailError && <p className="mt-1 text-xs text-[#FCA5A5]">{emailError}</p>}</div>
      <div><div className="mb-2 flex items-center justify-between gap-3"><label htmlFor="auth-password" className="text-sm font-semibold text-white">Password</label>{!isSignup && <button type="button" onClick={() => moveTo("forgot")} className="text-xs font-semibold text-[#D4D4D8] underline-offset-4 hover:text-white hover:underline">Forgot password?</button>}</div><div className="relative"><input id="auth-password" type={showPassword ? "text" : "password"} autoComplete={isSignup ? "new-password" : "current-password"} minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} onBlur={validatePassword} placeholder={isSignup ? "At least 6 characters" : "Your password"} className="min-h-12 w-full rounded-xl border border-white/[0.12] bg-white/[0.04] px-4 pr-12 text-sm text-white outline-none transition placeholder:text-[#71717A] focus:border-white/50 focus:ring-2 focus:ring-white/10" /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)} className="absolute right-1 top-1 grid h-10 w-10 place-items-center rounded-lg text-[#A1A1AA] hover:text-white">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>{passwordError && <p className="mt-1 text-xs text-[#FCA5A5]">{passwordError}</p>}</div>
      {isSignup && <label className="flex items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 text-xs leading-relaxed text-[#A1A1AA]"><input type="checkbox" checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-white" /><span>I am 18 or older and agree to the <Link to="/legal/$slug" params={{ slug: "terms" }} className="font-semibold text-white underline">Terms</Link> and <Link to="/legal/$slug" params={{ slug: "privacy" }} className="font-semibold text-white underline">Privacy Policy</Link>.</span></label>}
      {error && <p role="alert" className="rounded-xl border border-[#F87171]/30 bg-[#F87171]/10 px-3 py-2 text-sm text-[#FCA5A5]">{error}</p>}
      <button type="submit" disabled={loading || (isSignup && !ageConfirmed)} className="min-h-12 w-full rounded-xl bg-white text-sm font-bold text-[#111113] transition hover:bg-[#E4E4E7] disabled:cursor-not-allowed disabled:opacity-40">{loading ? "Please wait…" : isSignup ? "Create account" : "Log in"}</button>
    </form>
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs text-[#A1A1AA]"><button type="button" onClick={() => void resendEmail("signup")} disabled={loading} className="hover:text-white">Resend verification email</button><span aria-hidden="true">•</span><button type="button" onClick={() => moveTo(isSignup ? "signin" : "signup")} className="font-semibold text-white hover:underline">{isSignup ? "I already have an account" : "Create an account"}</button></div>
    {onCancel && <button type="button" onClick={onCancel} className="w-full text-center text-xs text-[#A1A1AA] hover:text-white">Cancel</button>}
  </section>;
}
