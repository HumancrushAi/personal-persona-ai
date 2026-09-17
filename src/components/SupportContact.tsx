import { LifeBuoy, Mail, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support-contact";
import { openSupport } from "@/components/SupportWidget";

// The support address, spelled out. Two ways in: email it directly, or open
// the ticket form, which emails the same inbox and is also answerable from the
// admin panel. Both go to the same place, so neither is the "wrong" one.
//
// `card` is the block on the account page and the FAQ; the default is the
// one-line version for a sidebar or a menu.
export function SupportContact({ card = false }: { card?: boolean }) {
  if (!card) {
    return (
      <a
        href={supportMailto()}
        className="inline-flex items-center gap-1.5 text-[11px] text-white/50 transition-colors hover:text-white"
      >
        <Mail className="h-3 w-3 shrink-0" />
        <span className="truncate">{SUPPORT_EMAIL}</span>
      </a>
    );
  }

  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="flex items-center gap-2 font-display text-2xl font-semibold">
        <LifeBuoy className="h-5 w-5 text-primary" /> Need help?
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Billing, a photo that never arrived, anything at all — email us and a person replies.
      </p>
      <a
        href={supportMailto()}
        className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/10 transition hover:bg-white/10"
      >
        <Mail className="h-4 w-4 text-primary" /> {SUPPORT_EMAIL}
      </a>
      <div className="mt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={openSupport}
          className="rounded-full px-3 text-xs text-muted-foreground"
        >
          <MessageSquare className="mr-1.5 h-3.5 w-3.5" /> Or send a message from here
        </Button>
      </div>
    </div>
  );
}
