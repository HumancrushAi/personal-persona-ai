import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// Client-side gate: redirect to /auth if not signed in.
// Returns `ready` = true only once a logged-in user is confirmed, so callers
// can hold rendering until then (avoids flashing gated content).
export function useRequireAuth(): boolean {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) navigate({ to: "/auth" });
      else setReady(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ready;
}
