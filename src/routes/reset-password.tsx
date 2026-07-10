import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Heart } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({ meta: [{ title: "Reset password — HumanCrush.ai" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  // The recovery link drops a one-time session in the URL, which supabase-js
  // consumes automatically. Confirm we actually have a session before allowing
  // a password change.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setHasSession(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated — you're signed in.");
      navigate({ to: "/me" });
    } catch (err: any) {
      toast.error(err.message ?? "Could not update password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="glass w-full max-w-md rounded-3xl p-8 shadow-glow">
        <Link to="/" className="flex items-center justify-center gap-2">
          <Heart className="h-6 w-6 fill-primary text-primary" />
          <span className="font-display text-2xl font-semibold">HumanCrush.ai</span>
        </Link>
        <h1 className="mt-6 text-center font-display text-3xl font-semibold">Set a new password</h1>

        {ready && !hasSession ? (
          <div className="mt-4 text-center text-sm text-muted-foreground">
            This reset link is invalid or has expired.{" "}
            <Link to="/auth" className="font-medium text-primary hover:underline">
              Request a new one
            </Link>
            .
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-3">
            <div>
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="border-white/10 bg-white/5"
              />
            </div>
            <div>
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm"
                type="password"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="border-white/10 bg-white/5"
              />
            </div>
            <Button
              type="submit"
              disabled={loading || !hasSession}
              className="w-full rounded-full bg-grad-primary text-primary-foreground shadow-glow"
            >
              Update password
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
