import { AuthForm, type AuthScreen, type AuthSource } from "@/components/auth/AuthForm";
import { CreatorSheet } from "@/components/creator/CreatorSheet";

const AUTH_MODAL_EVENT = "hc:open-auth-modal";

export type AuthModalRequest = {
  initialScreen?: Extract<AuthScreen, "signup" | "signin">;
  redirectPath?: string;
  companionId?: string;
};

export function openAuthModal(request: AuthModalRequest = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AuthModalRequest>(AUTH_MODAL_EVENT, { detail: request }));
}

export function listenForAuthModal(handler: (request: AuthModalRequest) => void) {
  const listener = (event: Event) => handler((event as CustomEvent<AuthModalRequest>).detail ?? {});
  window.addEventListener(AUTH_MODAL_EVENT, listener);
  return () => window.removeEventListener(AUTH_MODAL_EVENT, listener);
}

type AuthModalProps = {
  open: boolean;
  onClose: () => void;
  onAuthenticated: () => void;
  redirectPath?: string;
  companionId?: string;
  initialScreen?: Extract<AuthScreen, "signup" | "signin">;
  signupTitle?: string;
  prefillEmail?: string;
  collectPhone?: boolean;
  source?: AuthSource;
};

/** Shared responsive auth sheet; no provider or server configuration is defined here. */
export function AuthModal({ open, onClose, onAuthenticated, redirectPath, companionId, initialScreen = "signup", signupTitle, prefillEmail, collectPhone, source }: AuthModalProps) {
  return <CreatorSheet open={open} onClose={onClose} title="Account">
    <AuthForm initialScreen={initialScreen} redirectPath={redirectPath} companionId={companionId} compact onCancel={onClose} onAuthenticated={onAuthenticated} signupTitle={signupTitle} prefillEmail={prefillEmail} collectPhone={collectPhone} source={source} />
  </CreatorSheet>;
}
