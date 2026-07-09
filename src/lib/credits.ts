// Pure credit-wallet math, shared by chat + media server functions.
// No side effects — safe to unit test.

export type Balance = { free_messages_remaining?: number | null; paid_credits?: number | null };

export function totalCredits(bal: Balance | null | undefined): number {
  return (bal?.free_messages_remaining ?? 0) + (bal?.paid_credits ?? 0);
}

export function hasEnough(free: number, paid: number, cost: number): boolean {
  return free + paid >= cost;
}

// Deduct `cost` credits, spending free messages before paid credits.
// Assumes the caller already checked hasEnough().
export function applyDeduction(
  free: number,
  paid: number,
  cost: number,
): { free: number; paid: number } {
  let newFree = free;
  let newPaid = paid;
  let remaining = cost;
  if (newFree > 0) {
    const used = Math.min(newFree, remaining);
    newFree -= used;
    remaining -= used;
  }
  if (remaining > 0) newPaid -= remaining;
  return { free: newFree, paid: newPaid };
}
