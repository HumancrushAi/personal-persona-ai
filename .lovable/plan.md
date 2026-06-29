# AI Companion Chat — Build Plan

## Product
A site where users sign in, browse 25 attractive AI companions (diverse ethnicities), customize each one's personality, and chat. First **25 messages free** site-wide, then they must buy message credit packs via **Authorize.Net** (live).

## Stack
- Lovable Cloud (Postgres + Auth + server functions) on TanStack Start
- Lovable AI Gateway (`google/gemini-3-flash-preview`) for chat
- Authorize.Net **Accept.js** (hosted card fields, PCI-safe) + AIM API server-side for charges
- AI Elements for the chat UI

## Screens / Routes
- `/` — Landing (hero, "Meet your companion", CTA → sign up)
- `/auth` — Email/password + Google sign-in
- `/companions` — Grid of 25 (8 with generated portraits now, 17 with placeholder gradients + names that can be regenerated later)
- `/companions/$id` — Personality builder (sliders + text) → "Start chat"
- `/chat/$conversationId` — AI Elements chat with remaining-message counter
- `/credits` — Buy packs (Accept.js card form) + transaction history

## Personality Builder
- **Identity**: name override, age (18+ enforced), occupation
- **Traits**: 5 sliders (Flirty↔Reserved, Playful↔Serious, Bold↔Shy, Sweet↔Sassy, Intellectual↔Carefree)
- **Interests**: multi-select chips (music, fitness, travel, gaming, art, cooking, fashion, books, movies)
- **Style & backstory**: texting style (emojis/length), free-text backstory

Saved per (user, base_companion) so each user has their own version.

## Free → Paid Flow
- `credit_balances` row per user: `free_messages_used` (cap 25), `paid_credits` (int)
- Every user message: server fn checks `free_messages_used < 25` OR `paid_credits > 0`; deducts; then calls AI. If neither → 402 + open buy-credits modal.
- One message = one user→AI exchange (1 credit).

## Credit Packs
- $5 → 50 credits
- $10 → 120 credits (best value badge)
- $25 → 350 credits

## Authorize.Net Integration
- **Client**: load Accept.js, tokenize card → `opaqueData` (no raw PAN hits our server)
- **Server fn `chargeCredits`**: POST to `https://api.authorize.net/xml/v1/request.api` with `createTransactionRequest` + `payment.opaqueData`; on `responseCode === "1"`, increment `paid_credits` and insert `transactions` row
- Secrets: `AUTHORIZE_NET_API_LOGIN_ID`, `AUTHORIZE_NET_TRANSACTION_KEY`, `AUTHORIZE_NET_CLIENT_KEY` (public, for Accept.js)

## Database (RLS on all tables)
- `profiles` (id=auth.users, display_name)
- `companions` (id, name, ethnicity, age, base_bio, image_url, sort_order) — seeded with 25 rows
- `user_personalities` (id, user_id, companion_id, name_override, age, occupation, trait_flirty, trait_playful, trait_bold, trait_sweet, trait_intellectual, interests text[], texting_style, backstory)
- `conversations` (id, user_id, companion_id, personality_id, last_message_at)
- `messages` (id, conversation_id, role, content, created_at)
- `credit_balances` (user_id PK, free_messages_used int default 0, paid_credits int default 0)
- `transactions` (id, user_id, amount_cents, credits_added, authnet_transaction_id, status, created_at)

## Image Generation
Generate 8 tasteful portrait headshots now (Black, East Asian, South Asian, Latina, Middle Eastern, White/European, Mixed, Southeast Asian) — fully clothed, photographic, age 22-30. Remaining 17 get aesthetic gradient placeholders with first-initial monograms; can be regenerated on request.

## Design Direction
Warm, modern, romantic. Soft rose/cream palette (not purple). Editorial type pairing (Fraunces display + Inter body). Card-based companion grid. Cozy chat surface with no assistant bubble background (per chat-ui-composition).

## Out of Scope (v1)
- NSFW content (kept tasteful — Lovable AI moderation applies)
- Voice/video
- Multi-companion group chats
- Refunds UI (you handle in Authorize.Net dashboard)
- Webhook for chargebacks (can add later)

## Legal note
Authorize.Net requires a registered live merchant account and your account must permit the MCC for adult/companion services — confirm with your acquirer that this content is allowed before going live.
