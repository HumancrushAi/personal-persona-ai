# Chat trial, deferred verification and owner alerts

Settings live in `src/config/growth.ts`. Secrets are server env (see `.env.example`).

## How it works

| Stage | Who | Allowance | Content |
|---|---|---|---|
| 1 Guest | Supabase anonymous user, no email | 4 messages | Social only |
| 2 Email | Guest who entered an email in the inline card | +21 (25 total) | Social only |
| 3 Account | Email + password (or a configured provider) | Normal wallet and plans | As before |

- A chat text message costs 1 credit, so 4 credits = 4 messages and 25 = 25.
- The trial allowance is in `guest_trials`. It is debited atomically by the SQL function `consume_trial_credit`, and never touches `credit_balances`. An anonymous user's wallet is created at 0, so no photo, video or generator run can be paid for by a guest.
- When a guest signs up or logs in, `finishAuth` moves their `user_personalities`, `conversations` and `messages` to the real user id, then fires the `account_created` alert.
- Anonymous sessions count as signed out everywhere outside the chat (`src/lib/account-user.ts`).

## Manual steps (in this order)

1. **Apply the migration.** Open Supabase → project `bhjnfsqbocyfczpbxtrz` → SQL Editor. Paste `supabase/migrations/20261024000000_chat_trial.sql` and run it. Until this runs, guests get "account required" straight away and nothing else changes.
2. **Enable anonymous sign-ins.** Supabase → Authentication → Sign In / Providers → "Allow anonymous sign-ins" → on. Without it, signed-out visitors keep going to sign-up as before.
3. **Turn off email confirmation** (deferred verification). Supabase → Authentication → Sign In / Providers → Email → "Confirm email" → off. New sign-ups then land in the app immediately, and the app sends its own verification link.
4. **Env vars in Vercel** (Project → Settings → Environment Variables, Production and Preview), then redeploy:
   - `GROWTH_HASH_SECRET`: any long random string. Keep it stable; it salts IP and device hashes and signs verification links.
   - `PUBLIC_SITE_URL`: e.g. `https://humancrush.com` (the domain used in verification links).
   - `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (optional). In Telegram, message @BotFather, send `/newbot` and copy the token. Send your new bot any message, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `message.chat.id`.
   - `ALERT_EMAIL_TO` (optional): the address that gets an email copy of each alert. It uses the existing `RESEND_API_KEY` and `EMAIL_FROM`.
   - Turnstile (optional): Cloudflare dashboard → Turnstile → Add site → Managed mode. Set `TURNSTILE_SITE_KEY`, `VITE_TURNSTILE_SITE_KEY` (same value) and `TURNSTILE_SECRET_KEY`. To have Supabase also enforce captcha on sign-up and on anonymous sign-in, set the same secret in Supabase → Authentication → Attack Protection → Captcha (Turnstile).

## Funnel numbers

Run this in the Supabase SQL Editor:

```sql
SELECT * FROM public.funnel_daily ORDER BY day DESC LIMIT 30;
```

Columns: guests started, email walls shown, emails captured, account walls shown, accounts created (total and by source: chat_trial, generator, direct), and purchases. Raw events, with the variant and other properties, are in `public.funnel_events`.

## Experiment

`experimentSplit` in `growth.ts` defaults to 0, so everyone gets the trial. At 0.5, half of devices (sticky per browser) get the old behaviour, where an account is required before chatting.
