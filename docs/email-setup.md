# Email setup — Resend + Supabase SMTP

All auth emails (confirm signup, reset/forgot password, magic link, email change)
are sent by **Supabase Auth** over SMTP. We point that SMTP at **Resend**. The app
itself does not send these emails, so there is no app code to deploy for this —
only dashboard configuration.

## 1. Resend account
1. Create/log in at [resend.com](https://resend.com).
2. **Add & verify a sending domain** (Resend → Domains → Add Domain), e.g.
   `mail.humancrush.ai`. Add the DNS records Resend shows (SPF/DKIM). This is
   required to send from `no-reply@yourdomain` in production.
   - For quick testing only, Resend can send from `onboarding@resend.dev`, but it
     will only deliver to the Resend account owner's email. Use a verified domain
     for real users.
3. API key: `RESEND_API_KEY` (already in `.env.local`; the app doesn't use it
   directly — it's the SMTP password below).

## 2. Supabase → Authentication → SMTP settings
Enable **Custom SMTP** and enter:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` (SSL) — or `587` (TLS) |
| Username | `resend` |
| Password | the `RESEND_API_KEY` (`re_...`) |
| Sender email | `no-reply@yourdomain` (must be on the verified domain) |
| Sender name | `HumanCrush.ai` |

Then raise the auth email rate limit: **Authentication → Rate Limits → emails per
hour** (default is low; bump it for real traffic).

## 3. Redirect URLs (required for links to work)
**Authentication → URL Configuration → Redirect URLs** must include:
```
https://personal-persona-ai.vercel.app/**
```
(plus your custom domain when connected). Reset links open `/reset-password`.

## 4. Branded email templates
**Authentication → Emails** → for each template, paste the matching HTML from
`docs/email-templates/`:
- **Confirm signup** → `confirm-signup.html`
- **Reset Password** → `reset-password.html`

Suggested subjects:
- Confirm signup: `Confirm your HumanCrush.ai account`
- Reset password: `Reset your HumanCrush.ai password`

## 5. Test
1. Sign up with a real address → confirm email arrives (branded) → link verifies.
2. `/auth` → "Forgot password?" → reset email arrives → link opens
   `/reset-password` → set new password → signed in.

> If emails don't arrive: check the domain is verified in Resend, the sender
> address is on that domain, and the Supabase rate limit isn't exceeded. Resend →
> Logs shows every send + delivery status.
