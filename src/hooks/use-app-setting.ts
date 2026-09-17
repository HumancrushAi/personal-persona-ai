import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// One admin-managed setting, read with the public key. app_settings has a
// public-read policy, which is what lets the home page show the announcement
// banner without a server round trip; this is the same read, shared.
//
// Values are saved from text inputs, so a string comes back as a string and
// anything else as whatever JSON was stored.
export function useAppSetting(key: string) {
  return useQuery({
    queryKey: ["app-setting", key],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      return data?.value ?? null;
    },
    staleTime: 60_000,
  });
}

/** The admin's "System status" line, trimmed, or "" when there is none. */
export function useSystemStatus(): string {
  const { data } = useAppSetting("system_status_message");
  return typeof data === "string" ? data.trim() : "";
}
