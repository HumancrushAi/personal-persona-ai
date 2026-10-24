// Billing reminders before an auto-renewal. A plan renews on its own: the card
// on file is charged and the plan's credits are added on top of whatever is
// left (credits never expire). Three notices go out before that charge: an
// email 3, 2 and 1 days ahead, and a push as well on the last day.

const DAY = 86_400_000;
export const REMINDER_DAYS = [3, 2, 1] as const;
export type ReminderDay = (typeof REMINDER_DAYS)[number];

/**
 * Which reminder, if any, is due for a renewal at `renewsAt`. The daily job
 * runs once a day, and rounding up gives each of the three days exactly once.
 */
export function reminderDue(renewsAt: string | null | undefined, now = Date.now()): ReminderDay | null {
  if (!renewsAt) return null;
  const at = Date.parse(renewsAt);
  if (!Number.isFinite(at) || at <= now) return null;
  const days = Math.ceil((at - now) / DAY);
  return (REMINDER_DAYS as readonly number[]).includes(days) ? (days as ReminderDay) : null;
}

export function renewalCopy(input: { days: ReminderDay; planName: string; priceCents: number; credits: number; renewsAt: string }) {
  const when = input.days === 1 ? "tomorrow" : `in ${input.days} days`;
  const date = new Date(input.renewsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  const price = `$${(input.priceCents / 100).toFixed(input.priceCents % 100 === 0 ? 0 : 2)}`;
  return {
    title: `Your ${input.planName} plan renews ${when}`,
    body: `On ${date} we'll charge ${price} to the card on file and add ${input.credits.toLocaleString()} credits to your balance. Your current credits stay. Nothing to do if you're staying; you can cancel any time before then in Credits & billing.`,
    push: input.days === 1,
  };
}
