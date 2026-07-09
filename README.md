# HumanCrush.ai

AI companion chat platform. Users sign up, chat with AI personas, buy credits or
subscribe, and spend credits on messages, AI selfies, and voice notes. Admins
manage users, payments, credits, and personas from an in-app console.

**Stack:** TanStack Start (React 19 + TypeScript) · TailwindCSS · Supabase
(Postgres + Auth) · Authorize.Net · Vercel.

---

## 1. Project setup (local)

```bash
npm install
cp .env.example .env.local   # then fill in the values (see §2)
npm run dev                  # http://localhost:3000
```

Other scripts:

| Command | What it does |
|---|---|
| `npm run build` | Production build (Vercel/Nitro output) |
| `npm test` | Run the vitest suite once |
| `npm run test:watch` | Watch mode |
| `npm run lint` | ESLint |
| `npm run format` | Prettier write |

## 2. Environment variables

Copy `.env.example` → `.env.local`. On Vercel, set the same keys under
**Project Settings → Environment Variables** (Production **and** Preview).

`VITE_*` vars are inlined into the client bundle at **build time** — they must be
present when Vercel runs the build.

| Var | Scope | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | client | Public project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | client | Public (anon-equivalent) key |
| `SUPABASE_URL` | server | Same URL, server runtime |
| `SUPABASE_PUBLISHABLE_KEY` | server | Public key, server runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Full DB access. **No `VITE_` prefix. Never expose.** |
| `LOVABLE_API_KEY` | server only | Powers chat, image gen, TTS |
| `AUTHORIZE_NET_API_LOGIN_ID` | server | Also returned to client for Accept.js (public) |
| `AUTHORIZE_NET_CLIENT_KEY` | server | Returned to client for Accept.js (public) |
| `AUTHORIZE_NET_TRANSACTION_KEY` | **server only** | Secret. Never sent to client. |
| `AUTHORIZE_NET_SIGNATURE_KEY` | **server only** | Webhook HMAC secret. |

> **Security:** `.env*` is gitignored. Only `API_LOGIN_ID` and `CLIENT_KEY` reach
> the browser (required by Authorize.Net Accept.js). The transaction key, signature
> key, and service-role key are used exclusively inside server functions
> (`*.functions.ts`) and the webhook, via `src/integrations/supabase/client.server.ts`.

## 3. Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Apply migrations (schema, RLS, triggers, seed):
   ```bash
   supabase link --project-ref <your-ref>
   supabase db push
   ```
   Migrations live in `supabase/migrations/`. They create: `profiles`,
   `companions` (personas), `user_personalities`, `conversations`, `messages`,
   `credit_balances`, `transactions`, `credit_ledger`, `subscription_events`,
   `user_roles`, and the `handle_new_user` trigger that provisions a profile +
   25 free credits on signup.
3. **Auth:** enable Email and (optionally) Google providers. Set the Site URL and
   redirect URLs to your domain.

## 4. Vercel deployment

- **GitHub is the source of truth.** Pushes to `main` deploy to production.
- Framework preset: Vite. Build command `npm run build`, output handled by the
  Nitro/Vercel preset (see `vercel.json`).
- Set all env vars from §2 (Production + Preview) **before** the first build.
- **Domain & SSL:** add the domain in Vercel → Domains; SSL is provisioned
  automatically. Verify `https://` loads and the cert is valid.

Post-deploy smoke test: sign up → chat sends → buy a small credit pack →
credits increase → open `/history` → open `/admin` as an admin.

## 5. Authorize.Net setup

- Use **live** credentials (the API URL in `payments.functions.ts` is the live
  endpoint).
- Credit-pack purchases are one-time `authCaptureTransaction`s. Subscriptions use
  **ARB** (recurring) via `ARBCreateSubscriptionRequest`.
- **Webhook:** in Authorize.Net → Account → Webhooks, add
  `https://<your-domain>/api/public/authnet-webhook` and subscribe to
  `net.authorize.customer.subscription.*` and
  `net.authorize.payment.authcapture.created`. The endpoint verifies the
  `X-ANET-Signature` HMAC-SHA512 header against `AUTHORIZE_NET_SIGNATURE_KEY`.

## 6. Admin usage

### Granting the first admin
Admin access is gated by the `user_roles` table + `has_role()` RPC. The first
admin must be set manually (an admin can promote others afterward). In the
Supabase SQL editor:

```sql
insert into public.user_roles (user_id, role)
values ('<auth-user-uuid>', 'admin')
on conflict do nothing;
```

Then visit `/admin` (only visible to admins; others see "Admins only").

### What admins can do (`/admin`)
**Users tab**
- Search users by email/name; create accounts.
- View email, subscription tier/status/renewal, free + paid credit balances, roles.
- Adjust credits (`+50 / +200 / +1000 / Zero`) — logged as a transaction.
- Set/clear subscription tier.
- Grant/revoke the admin role.
- **Payments** button → inline per-user payment history + credit-activity ledger.

**Personas tab**
- List every persona (active + inactive).
- Create/edit: name, avatar URL, description, personality prompt, tags,
  language, ethnicity, gender, age (18+), art style, and active/inactive status.
- All personas are enforced **18+** (UI + DB `CHECK` constraint).

## 7. Managing personas

Personas are rows in the `companions` table — **not hardcoded**. Edit them in the
Personas tab (§6). Setting **Inactive** hides a persona from the public catalog
(RLS returns only `status = 'active'` to end users; admins see all via the
service-role client). Language defaults to `en`; see `src/lib/languages.ts` for
the supported set (en, es, pt, ja, fr, de) — the foundation for future
translation.

## 8. Managing tokens & subscriptions

- **Credits** = "messages." A text message costs 1, an AI selfie 8, a voice note 3.
  Free credits are spent before paid credits (`src/lib/credits.ts`).
- New users get **25 free** credits on signup.
- Purchases and renewals grant paid credits and write a row to both
  `transactions` (money) and `credit_ledger` (running balance). Declined charges
  are recorded with `status = 'failed'`.
- The AI request path checks balance first and blocks with `OUT_OF_CREDITS` when
  empty (`src/lib/chat.functions.ts`, `src/lib/media.functions.ts`).
- Admins can manually adjust credits or set a subscription tier without a charge.

## 9. Safety

Moderation is a reusable server-side layer (`src/lib/safety.ts`,
`screenUserMessage`) applied before any AI call — **not** in UI components. It
blocks minor-related and other prohibited/illegal requests and returns a
`BLOCKED_CONTENT` error. Every persona is 18+ (enforced by the DB constraint and
the admin form).

## 10. Testing / QA

`npm test` runs the vitest suite (credit math, catalog integrity, Authorize.Net
success/decline parsing, webhook signature verification, moderation, languages,
and an end-to-end wallet+payment flow).

Manual QA checklist: signup · login · logout · protected routes (`/me`,
`/admin`) · user dashboard · admin console · subscription flow · credit purchase ·
credit deduction · `/history` · mobile responsiveness · browser check · console
errors · broken links.

> A full live-Supabase e2e (browser-driven auth/protected-route tests) needs
> `supabase start` (Docker) + Playwright and is not included in the unit+integration suite.

## 11. Repo map

```
src/
  routes/            file-based routes (auth, browse, chat, credits, history, me, _authenticated/admin)
  lib/               server functions (*.functions.ts) + pure helpers (credits, authnet, safety, languages)
  integrations/supabase/  client (browser), client.server (service role), auth middleware, types
supabase/migrations/ schema, RLS, triggers, seed data
```
