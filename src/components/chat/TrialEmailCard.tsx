import { useEffect, useRef, useState, type FormEvent } from "react";
import { growthConfig } from "@/config/growth";
import { captchaToken } from "@/lib/guest-chat";
import { submitTrialEmail } from "@/lib/trial.functions";
import { isDisposableEmail, isValidEmail, type TrialStatus } from "@/lib/trial";

const ERRORS: Record<string, string> = {
  INVALID_EMAIL: "Enter an email like name@example.com.",
  DISPOSABLE_EMAIL: "Use a permanent email address, not a throwaway inbox.",
  EMAIL_ALREADY_USED: "That email already claimed its free messages. Create an account to keep chatting.",
  CAPTCHA_FAILED: "We could not check you are human. Try again.",
  ALREADY_CAPTURED: "You already added your email.",
};

/**
 * Stage 2 of the chat trial, inline at the foot of the thread so the
 * conversation stays visible above it. Not a modal.
 */
export function TrialEmailCard({ modelName, companionId, onCaptured, onNeedAccount }: {
  modelName: string;
  companionId?: string;
  onCaptured: (status: TrialStatus, email: string) => void;
  onNeedAccount: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const cardRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    cardRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!isValidEmail(email)) return setError(ERRORS.INVALID_EMAIL);
    if (isDisposableEmail(email)) return setError(ERRORS.DISPOSABLE_EMAIL);
    setLoading(true);
    try {
      const result = await submitTrialEmail({ data: { email, marketingConsent: consent, captchaToken: await captchaToken(), modelId: companionId } });
      if (result.ok) onCaptured(result.status, result.email);
      else if (result.code === "EMAIL_ALREADY_USED" || result.code === "ALREADY_CAPTURED") onNeedAccount(email);
      else setError(ERRORS[result.code] ?? "Something went wrong. Try again.");
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form ref={cardRef} onSubmit={(event) => void submit(event)} noValidate className="mx-auto w-full max-w-md rounded-2xl border border-white/[0.12] bg-[#19191C] p-4 text-white shadow-lg">
      <p className="text-[15px] font-semibold leading-snug">{modelName} wants to keep talking. Enter your email to get {growthConfig.chatTrial.emailCredits} more messages.</p>
      <label htmlFor="trial-email" className="sr-only">Email</label>
      <input
        id="trial-email"
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        onFocus={(event) => window.setTimeout(() => event.target.scrollIntoView({ block: "center", behavior: "smooth" }), 250)}
        placeholder="name@example.com"
        className="mt-3 min-h-12 w-full rounded-xl border border-white/[0.14] bg-white/[0.04] px-4 text-base text-white outline-none placeholder:text-[#71717A] focus:border-white/50"
      />
      {error && <p role="alert" className="mt-1.5 text-xs text-[#FCA5A5]">{error}</p>}
      <label className="mt-3 flex items-start gap-2.5 text-xs leading-relaxed text-[#A1A1AA]">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 h-4 w-4 accent-white" />
        <span>Send me updates and offers</span>
      </label>
      <button type="submit" disabled={loading} className="mt-3 min-h-12 w-full rounded-xl bg-white text-sm font-bold text-[#111113] transition hover:bg-[#E4E4E7] disabled:opacity-50">{loading ? "Saving…" : "Keep chatting"}</button>
    </form>
  );
}
