import { useState } from "react";
import { MessageSquare, X, Phone, MessageCircle } from "lucide-react";
import { Button } from "./ui/button";

export function SupportWidget() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="fixed bottom-24 lg:bottom-6 right-4 lg:right-6 z-50">
      {/* Floating Action Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-grad-primary text-primary-foreground shadow-glow transition hover:scale-105"
          aria-label="Contact Support"
        >
          <MessageSquare className="h-6 w-6" />
        </button>
      )}

      {/* Support Card Popup */}
      {isOpen && (
        <div className="glass w-72 rounded-2xl p-5 shadow-glow border border-white/10 relative animate-fade-in bg-background/95 backdrop-blur-xl">
          <button
            onClick={() => setIsOpen(false)}
            className="absolute top-3 right-3 text-muted-foreground hover:text-foreground p-1 rounded-full transition-colors"
            aria-label="Close Support Window"
          >
            <X className="h-4 w-4" />
          </button>

          <h3 className="font-display font-semibold text-lg text-white mb-2 flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" /> Support & Help
          </h3>
          
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            Need help? Text or message us directly in case of an issue with your account, billing, or character creation.
          </p>

          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/5 p-3">
              <Phone className="h-4 w-4 text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">SMS / Text</p>
                <a
                  href="sms:+17082537082"
                  className="text-sm font-medium text-white hover:text-primary transition-colors block"
                >
                  708-253-7082
                </a>
              </div>
            </div>

            <Button
              asChild
              className="w-full rounded-xl bg-grad-primary text-primary-foreground font-semibold flex items-center justify-center gap-1.5"
            >
              <a href="sms:+17082537082">
                <MessageCircle className="h-4 w-4" /> Text Support
              </a>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
