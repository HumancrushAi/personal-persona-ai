import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Heart, Eye, EyeOff, X } from "lucide-react";
import { toast } from "sonner";

import { z } from "zod";

const authSearchSchema = z.object({
  companion: z.string().optional(),
  redirect: z.string().optional(),
  mode: z.enum(["signin", "signup"]).optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: (search) => authSearchSchema.parse(search),
  head: () => ({ meta: [{ title: "Create your account — HumanCrush.com" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { companion, redirect, mode: modeParam } = Route.useSearch();

  // After auth, go straight to the redirected page, companion, or browse.
  const goAfterAuth = () => {
    if (redirect) {
      navigate({ to: redirect as any });
    } else if (companion) {
      navigate({ to: "/companion/$id", params: { id: companion } });
    } else {
      navigate({ to: "/browse" });
    }
  };
  // Signing up is the default, not signing in.
  //
  // Everyone who lands here from a gated action — tapping chat on a companion,
  // finishing the create wizard — is by definition someone without an account,
  // and showing them a login form asks them to remember a password they never
  // set. The toggle to sign in is right below the button for the minority who
  // already have one, and ?mode=signin still opens straight on it for a link
  // that knows better.
  const [mode, setMode] = useState<"signin" | "signup">(modeParam ?? "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [agreedAge, setAgreedAge] = useState(false);
  const googleEnabled = import.meta.env.VITE_ENABLE_GOOGLE_AUTH === "true";

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "signup") {
      if (!agreedAge) {
        toast.error("You must confirm you are 18+ years of age to sign up.");
        return;
      }
      await confirmSignup();
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      goAfterAuth();
    } catch (err: any) {
      toast.error(err.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function confirmSignup() {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      toast.success("Welcome — check your email to confirm.");
      setMode("signin");
    } catch (err: any) {
      toast.error(err.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot() {
    if (!email) {
      toast.error("Enter your email first, then tap “Forgot password?”");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success("Password reset link sent — check your email.");
    } catch (err: any) {
      toast.error(err.message ?? "Could not send reset email");
    } finally {
      setLoading(false);
    }
  }

  async function handleResendConfirmation() {
    if (!email) {
      toast.error("Enter your email first, then tap “Resend verification?”");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      toast.success("Verification link resent — check your email.");
    } catch (err: any) {
      toast.error(err.message ?? "Could not resend verification email");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    try {
      // Supabase-native OAuth: redirects the browser to Google, then back.
      const dest = redirect ? redirect : companion ? `/companion/${companion}` : "/browse";
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}${dest}` },
      });
      if (error) throw error;
    } catch (err: any) {
      toast.error(err.message ?? "Sign-in failed");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="glass relative w-full max-w-md rounded-3xl p-8 shadow-glow">
        <Link
          to="/"
          aria-label="Close"
          className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-muted-foreground hover:bg-white/20 hover:text-foreground transition-colors"
        >
          <X className="h-5 w-5" />
        </Link>
        <Link to="/" className="flex items-center justify-center gap-2">
          <Heart className="h-6 w-6 fill-primary text-primary" />
          <span className="font-display text-2xl font-semibold">HumanCrush.com</span>
        </Link>
        <h1 className="mt-6 text-center font-display text-3xl font-semibold">
          {mode === "signin" ? "Welcome back" : "She's waiting."}
        </h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          {mode === "signin"
            ? "Sign in to keep your chats and credits."
            : "25 free messages, no card needed. 18+ only."}
        </p>

        {googleEnabled && (
          <>
            <Button
              onClick={handleGoogle}
              variant="outline"
              className="mt-6 w-full rounded-full border-white/15 bg-white/5"
              disabled={loading}
            >
              Continue with Google
            </Button>

            <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" /> or email{" "}
              <div className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        <form onSubmit={handleEmail} className={googleEnabled ? "space-y-3" : "mt-6 space-y-3"}>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-white/10 bg-white/5"
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPw ? "text" : "password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="border-white/10 bg-white/5 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {mode === "signup" && (
            <div className="flex items-start gap-2.5 pt-2 pb-1">
              <input
                id="age18"
                type="checkbox"
                required
                checked={agreedAge}
                onChange={(e) => setAgreedAge(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-white/20 bg-white/10 text-primary accent-primary focus:ring-primary cursor-pointer"
              />
              <label
                htmlFor="age18"
                className="text-xs text-muted-foreground leading-snug cursor-pointer select-none"
              >
                I confirm I am{" "}
                <span className="font-semibold text-foreground">18 years of age or older</span> (21+
                where required) and agree to the Terms of Service & Privacy Policy 🔞
              </label>
            </div>
          )}
          <Button
            type="submit"
            className="w-full rounded-full bg-grad-primary text-primary-foreground shadow-glow"
            disabled={loading || (mode === "signup" && !agreedAge)}
          >
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
          {mode === "signin" && (
            <button
              type="button"
              onClick={handleForgot}
              disabled={loading}
              className="text-muted-foreground hover:text-primary hover:underline"
            >
              Forgot password?
            </button>
          )}
          <button
            type="button"
            onClick={handleResendConfirmation}
            disabled={loading}
            className="text-muted-foreground hover:text-primary hover:underline"
          >
            Resend verification?
          </button>
        </div>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="font-medium text-primary hover:underline"
          >
            {mode === "signin" ? "Create account" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
