import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { z } from "zod";
import { LogoLink } from "@/components/Logo";
import { confirmEmail } from "@/lib/verify-email.functions";

export const Route = createFileRoute("/verify-email")({
  ssr: false,
  validateSearch: z.object({ u: z.string().optional(), t: z.string().optional() }),
  head: () => ({ meta: [{ title: "Confirm email — HumanCrush.com" }, { name: "robots", content: "noindex" }] }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { u, t } = Route.useSearch();
  const [state, setState] = useState<"checking" | "ok" | "bad">("checking");

  useEffect(() => {
    if (!u || !t) {
      setState("bad");
      return;
    }
    confirmEmail({ data: { u, t } })
      .then((result) => setState(result.ok ? "ok" : "bad"))
      .catch(() => setState("bad"));
  }, [u, t]);

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#111113] px-5 text-white">
      <div className="w-full max-w-sm text-center">
        <LogoLink className="mx-auto h-8" />
        {state === "checking" && <p className="mt-10 text-sm text-[#A1A1AA]">Confirming your email…</p>}
        {state === "ok" && (
          <>
            <CheckCircle2 className="mx-auto mt-10 h-10 w-10 text-[#7FE0B0]" />
            <h1 className="mt-4 font-display text-[26px] font-extrabold">Email confirmed</h1>
            <p className="mt-2 text-sm text-[#A1A1AA]">You can recover your account with this address any time.</p>
          </>
        )}
        {state === "bad" && (
          <>
            <XCircle className="mx-auto mt-10 h-10 w-10 text-[#FCA5A5]" />
            <h1 className="mt-4 font-display text-[26px] font-extrabold">That link did not work</h1>
            <p className="mt-2 text-sm text-[#A1A1AA]">It may be old or copied incompletely. Sign in and use "Resend email" on the banner for a new one.</p>
          </>
        )}
        <Link to="/browse" className="mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-white text-sm font-bold text-[#111113]">Continue</Link>
      </div>
    </main>
  );
}
