// How much of the conversation reaches the model.
//
// It used to be ten messages. The model in use (sao10k/l3.1-euryale-70b) has a
// 131,072-token context window, so the app was handing it roughly half a
// percent of what it can read, and then the prompt was blamed when replies did
// not follow the conversation.
//
// This fills the window instead: newest messages first, back through the
// conversation until the budget runs out, then flipped to chronological order.
// Newest-first because if anything has to be dropped it must be the oldest
// turn, never the message the user just sent.

export type BudgetedMsg = { role: string; content: string };

/**
 * Token estimate from character count.
 *
 * There is no tokenizer for a Llama-family model in this project and pulling
 * one in to size a request is not worth it. 3.5 characters per token
 * deliberately UNDERSTATES the characters a token holds — English averages
 * closer to 4 — so the estimate runs high and the request fits. Emoji and
 * accented text tokenize worse than English, which the margin also covers.
 *
 * The +4 is the per-message envelope: every message costs a few tokens for its
 * role and separators on top of its content.
 */
export function estimateTokens(text: string): number {
  return Math.ceil((text ?? "").length / 3.5) + 4;
}

/**
 * Take as much of the tail of `messages` as fits in `budgetTokens`.
 *
 * Returns the kept messages in chronological order, plus what was dropped, so
 * the caller can decide whether the summary still needs to carry the opening of
 * the conversation.
 *
 * The newest message is kept even if it alone exceeds the budget — a request
 * that omits what the user just typed is the bug this whole file exists to
 * prevent, and the model refusing an over-long prompt is a better failure than
 * answering the wrong question.
 */
export function fitToBudget(
  messages: BudgetedMsg[],
  budgetTokens: number,
): { kept: BudgetedMsg[]; dropped: number; tokens: number } {
  const all = messages ?? [];
  if (!all.length) return { kept: [], dropped: 0, tokens: 0 };

  const kept: BudgetedMsg[] = [];
  let tokens = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    const cost = estimateTokens(all[i].content);
    // Always keep the newest, whatever it costs.
    if (kept.length && tokens + cost > budgetTokens) break;
    kept.push(all[i]);
    tokens += cost;
  }
  kept.reverse();
  return { kept, dropped: all.length - kept.length, tokens };
}
