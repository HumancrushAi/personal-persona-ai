import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Heart } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — HumanCrush.ai" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        toast.success("Welcome — check your email to confirm.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/browse" });
      }
    } catch (err: any) { toast.error(err.message ?? "Something went wrong"); }
    finally { setLoading(false); }
  }

  async function handleGoogle() {
    setLoading(true);
    try {
      // Supabase-native OAuth: redirects the browser to Google, then back to /browse.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/browse` },
      });
      if (error) throw error;
    } catch (err: any) { toast.error(err.message ?? "Sign-in failed"); setLoading(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="glass w-full max-w-md rounded-3xl p-8 shadow-glow">
        <Link to="/" className="flex items-center justify-center gap-2">
          <Heart className="h-6 w-6 fill-primary text-primary" />
          <span className="font-display text-2xl font-semibold">HumanCrush.ai</span>
        </Link>
        <h1 className="mt-6 text-center font-display text-3xl font-semibold">
          {mode === "signin" ? "Welcome back" : "She's waiting."}
        </h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          {mode === "signin" ? "Sign in to keep your chats and credits." : "25 free messages, no card needed. 18+ only."}
        </p>

        <Button onClick={handleGoogle} variant="outline" className="mt-6 w-full rounded-full border-white/15 bg-white/5" disabled={loading}>
          Continue with Google
        </Button>

        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> or email <div className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={handleEmail} className="space-y-3">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} className="border-white/10 bg-white/5" />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} className="border-white/10 bg-white/5" />
          </div>
          <Button type="submit" className="w-full rounded-full bg-grad-primary text-primary-foreground shadow-glow" disabled={loading}>
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
          <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="font-medium text-primary hover:underline">
            {mode === "signin" ? "Create account" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
