import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { messagesLeft } from "@/config/growth";
import { allowanceFor, evaluateTrial, isDisposableEmail, isE164, isExplicitRequest, trialVariant } from "../trial";
import { captureTrialEmail, migrateGuestToUser, openGuestTrial, reserveTrialMessage } from "../trial.server";
import { formatAlert, sendOwnerAlert } from "../growth.server";
import { isAccount } from "../account-user";

type Row = Record<string, any>;

/**
 * In-memory stand-in for the service-role client: just the PostgREST calls
 * the trial store makes, plus the two SQL functions with the same semantics
 * as the migration (the allowance check lives inside the UPDATE).
 */
function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = { guest_trials: [], leads: [], user_personalities: [], conversations: [], messages: [], profiles: [], ...seed };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  function query(table: string) {
    const filters: ((row: Row) => boolean)[] = [];
    let mode: "select" | "update" | "insert" = "select";
    let patch: Row = {};
    let head = false;
    const rows = () => (tables[table] ??= []).filter((row) => filters.every((f) => f(row)));
    const builder: any = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) { head = !!opts?.head; return builder; },
      eq(col: string, value: unknown) { filters.push((row) => row[col] === value); return builder; },
      gte(col: string, value: string) { filters.push((row) => String(row[col]) >= value); return builder; },
      ilike(col: string, value: string) { filters.push((row) => String(row[col]).toLowerCase() === value.toLowerCase()); return builder; },
      update(values: Row) { mode = "update"; patch = values; return builder; },
      insert(values: Row) {
        mode = "insert";
        if (table === "leads" && values.source === "chat_trial" && tables.leads.some((l) => l.source === "chat_trial" && l.email.toLowerCase() === values.email.toLowerCase())) {
          return Promise.resolve({ error: { code: "23505" } });
        }
        tables[table].push({ created_at: new Date().toISOString(), ...values });
        return Promise.resolve({ error: null });
      },
      async maybeSingle() { await tick(); return { data: rows()[0] ? { ...rows()[0] } : null }; },
      then(resolve: (value: unknown) => void) {
        void tick().then(() => {
          if (mode === "update") { rows().forEach((row) => Object.assign(row, patch)); resolve({ error: null }); }
          else resolve(head ? { count: rows().length, error: null } : { data: rows(), error: null });
        });
      },
    };
    return builder;
  }

  return {
    tables,
    from: query,
    async rpc(name: string, args: Row) {
      await tick();
      const row = tables.guest_trials.find((r) => r.user_id === args.p_user);
      if (name === "consume_trial_credit") {
        const limit = row?.stage === "email" ? args.p_guest_allowance + args.p_email_allowance : args.p_guest_allowance;
        if (!row || row.credits_used + args.p_cost > limit) return { data: null, error: null };
        row.credits_used += args.p_cost;
        return { data: row.credits_used, error: null };
      }
      if (name === "refund_trial_credit" && row) row.credits_used = Math.max(0, row.credits_used - args.p_cost);
      return { data: null, error: null };
    },
  };
}

const guestRow = (userId: string, extra: Row = {}) => ({ user_id: userId, stage: "guest", credits_used: 0, captured_email: null, ip_hash: "ip", device_hash: `dev-${userId}`, variant: "trial", model_id: null, utm: null, referrer: null, linked_user_id: null, ...extra });

describe("trial allowance (8.1)", () => {
  it("stage 1 allows exactly 4 messages, stage 2 exactly 25 in total", () => {
    expect(allowanceFor("guest")).toBe(4);
    expect(allowanceFor("email")).toBe(25);
    expect(evaluateTrial("guest", 3)).toEqual({ ok: true, remainingAfter: 0 });
    expect(evaluateTrial("guest", 4)).toEqual({ ok: false, code: "TRIAL_EMAIL_REQUIRED" });
    expect(evaluateTrial("email", 24)).toEqual({ ok: true, remainingAfter: 0 });
    expect(evaluateTrial("email", 25)).toEqual({ ok: false, code: "TRIAL_ACCOUNT_REQUIRED" });
  });

  it("a cost that does not divide the allowance never overspends", () => {
    expect(evaluateTrial("guest", 2, 3)).toEqual({ ok: false, code: "TRIAL_EMAIL_REQUIRED" });
    expect(evaluateTrial("guest", 1, 3)).toEqual({ ok: true, remainingAfter: 0 });
    expect(messagesLeft(5, 3)).toBe(1);
    expect(messagesLeft(2, 3)).toBe(0);
  });

  it("parallel sends cannot overspend the guest allowance", async () => {
    const db = fakeDb({ guest_trials: [guestRow("g1")] });
    const results = await Promise.all(Array.from({ length: 10 }, () => reserveTrialMessage(db, "g1")));
    expect(results.filter((r) => r.ok)).toHaveLength(4);
    expect(db.tables.guest_trials[0].credits_used).toBe(4);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.code === "TRIAL_EMAIL_REQUIRED")).toBe(true);
  });
});

describe("server walls (8.2)", () => {
  it("rejects the 5th guest message without email and the 26th without an account", async () => {
    const db = fakeDb({ guest_trials: [guestRow("g2")] });
    for (let i = 0; i < 4; i++) expect((await reserveTrialMessage(db, "g2")).ok).toBe(true);
    const fifth = await reserveTrialMessage(db, "g2");
    expect(fifth).toMatchObject({ ok: false, code: "TRIAL_EMAIL_REQUIRED" });

    expect((await captureTrialEmail(db, { userId: "g2", email: "Pat@Example.com", marketingConsent: false })).ok).toBe(true);
    for (let i = 0; i < 21; i++) expect((await reserveTrialMessage(db, "g2")).ok).toBe(true);
    const twentySixth = await reserveTrialMessage(db, "g2");
    expect(twentySixth).toMatchObject({ ok: false, code: "TRIAL_ACCOUNT_REQUIRED" });
    expect(db.tables.guest_trials[0].credits_used).toBe(25);
  });

  it("a guest without a trial session is never served", async () => {
    expect(await reserveTrialMessage(fakeDb(), "nobody")).toMatchObject({ ok: false, code: "TRIAL_MISSING" });
  });
});

describe("email stage and abuse limits (8.3)", () => {
  it("one stage-2 grant per email address, across devices", async () => {
    const db = fakeDb({ guest_trials: [guestRow("a"), guestRow("b")] });
    expect(await captureTrialEmail(db, { userId: "a", email: "same@example.com", marketingConsent: true })).toMatchObject({ ok: true });
    expect(await captureTrialEmail(db, { userId: "b", email: "SAME@example.com", marketingConsent: false })).toEqual({ ok: false, code: "EMAIL_ALREADY_USED" });
    expect(db.tables.guest_trials.find((r) => r.user_id === "b")!.stage).toBe("guest");
    expect(db.tables.leads).toHaveLength(1);
    expect(db.tables.leads[0]).toMatchObject({ source: "chat_trial", marketing_consent: true });
  });

  it("rejects disposable and malformed addresses", async () => {
    const db = fakeDb({ guest_trials: [guestRow("c")] });
    expect(await captureTrialEmail(db, { userId: "c", email: "x@mailinator.com", marketingConsent: false })).toEqual({ ok: false, code: "DISPOSABLE_EMAIL" });
    expect(await captureTrialEmail(db, { userId: "c", email: "not-an-email", marketingConsent: false })).toEqual({ ok: false, code: "INVALID_EMAIL" });
    expect(isDisposableEmail("someone@gmail.com")).toBe(false);
  });

  it("caps guest sessions per IP per day and per device", async () => {
    const db = fakeDb();
    for (const id of ["s1", "s2", "s3"]) {
      expect(await openGuestTrial(db, { userId: id, ipHash: "same-ip", deviceHash: `d-${id}`, variant: "trial" })).toMatchObject({ ok: true, created: true });
    }
    expect(await openGuestTrial(db, { userId: "s4", ipHash: "same-ip", deviceHash: "d-s4", variant: "trial" })).toEqual({ ok: false, code: "TRIAL_LIMIT_IP" });
    expect(await openGuestTrial(db, { userId: "s5", ipHash: "other-ip", deviceHash: "d-s1", variant: "trial" })).toEqual({ ok: false, code: "TRIAL_LIMIT_DEVICE" });
    // A reload by the same guest is not a new session and is not capped.
    expect(await openGuestTrial(db, { userId: "s1", ipHash: "same-ip", deviceHash: "d-s1", variant: "trial" })).toMatchObject({ ok: true, created: false });
  });

  it("IP caps reset after a day", async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const db = fakeDb({ guest_trials: ["o1", "o2", "o3"].map((id) => ({ ...guestRow(id, { ip_hash: "busy" }), created_at: old })) });
    expect(await openGuestTrial(db, { userId: "fresh", ipHash: "busy", deviceHash: "d-fresh", variant: "trial" })).toMatchObject({ ok: true });
  });
});

describe("guest Social mode (8.4)", () => {
  it("flags explicit asks and leaves ordinary chat alone", () => {
    for (const text of ["send me nudes", "can we have sex", "show me your tits", "talk dirty to me", "take your top off", "I'm so horny"]) {
      expect(isExplicitRequest(text), text).toBe(true);
    }
    for (const text of ["I love your hair", "how old are you?", "what are you up to tonight", "it's hard for me to sleep", "I passed my class", "you look cute in that dress"]) {
      expect(isExplicitRequest(text), text).toBe(false);
    }
  });

  it("a deflected guest message is not charged: the trial debit only happens at reserve", async () => {
    // sendChatMessage returns the deflection before reserveTrialMessage runs;
    // the store itself is unchanged by anything but a reserve.
    const db = fakeDb({ guest_trials: [guestRow("d1", { credits_used: 2 })] });
    expect(db.tables.guest_trials[0].credits_used).toBe(2);
    const source = readFileSync(join(__dirname, "..", "chat.functions.ts"), "utf8");
    const deflect = source.indexOf("explicit_request_deflected");
    const reserve = source.indexOf("reserveTrialMessage(trialDb");
    expect(deflect).toBeGreaterThan(0);
    expect(reserve).toBeGreaterThan(deflect);
    // Guests never reach a paid render: media asks are in the deflection test,
    // and their wallet starts at 0 in the migration.
    expect(source).toMatch(/isExplicitRequest\(data\.content\) \|\| wantsSelfie\(data\.content\) \|\| wantsVideo\(data\.content\)/);
    const migration = readFileSync(join(__dirname, "..", "..", "..", "supabase", "migrations", "20261024000000_chat_trial.sql"), "utf8");
    expect(migration).toMatch(/is_anonymous[\s\S]*free_messages_remaining\) VALUES \(NEW\.id, 0\)/);
  });
});

describe("guest conversation follows the user (8.5)", () => {
  it("moves personalities, conversations and messages, and links the lead", async () => {
    const db = fakeDb({
      user_personalities: [{ id: "p1", user_id: "guest" }],
      conversations: [{ id: "c1", user_id: "guest" }],
      messages: [{ id: "m1", user_id: "guest" }, { id: "m2", user_id: "guest" }, { id: "x", user_id: "someone-else" }],
      profiles: [{ id: "guest", display_name: "Dave", user_memory: "name: Dave" }, { id: "real", display_name: "dave.k", user_memory: null }],
      guest_trials: [guestRow("guest", { stage: "email" })],
      leads: [{ email: "dave@example.com", guest_session_id: "guest", source: "chat_trial", user_id: null }],
    });
    await migrateGuestToUser(db, "guest", "real");
    expect(db.tables.user_personalities[0].user_id).toBe("real");
    expect(db.tables.conversations[0].user_id).toBe("real");
    expect(db.tables.messages.filter((m) => m.user_id === "real")).toHaveLength(2);
    expect(db.tables.messages.find((m) => m.id === "x")!.user_id).toBe("someone-else");
    expect(db.tables.profiles.find((p) => p.id === "real")).toMatchObject({ display_name: "Dave", user_memory: "name: Dave" });
    expect(db.tables.guest_trials[0].linked_user_id).toBe("real");
    expect(db.tables.leads[0].user_id).toBe("real");
  });

  it("works the same for an existing account the guest logs into", async () => {
    const db = fakeDb({ conversations: [{ id: "old", user_id: "existing" }, { id: "trial", user_id: "guest2" }], profiles: [{ id: "guest2" }, { id: "existing", display_name: "Sam", user_memory: "likes: tennis" }] });
    await migrateGuestToUser(db, "guest2", "existing");
    expect(db.tables.conversations.map((c) => c.user_id)).toEqual(["existing", "existing"]);
    expect(db.tables.profiles.find((p) => p.id === "existing")).toMatchObject({ display_name: "Sam", user_memory: "likes: tennis" });
  });
});

describe("owner alerts (8.6)", () => {
  it("a failing or hanging channel never throws and never holds sign-up", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "1");
    vi.stubEnv("ALERT_EMAIL_TO", "owner@example.com");
    vi.stubEnv("RESEND_API_KEY", "re_x");
    const failing = vi.fn(async () => { throw new Error("telegram down"); }) as unknown as typeof fetch;
    const failingEmail = vi.fn(async () => { throw new Error("resend down"); });
    await expect(sendOwnerAlert("account_created", { email: "a@b.co" }, { fetcher: failing, sendEmail: failingEmail })).resolves.toBeUndefined();
    expect(failing).toHaveBeenCalledOnce();
    expect(failingEmail).toHaveBeenCalledOnce();

    const hanging = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const started = Date.now();
    await sendOwnerAlert("lead_captured", { email: "a@b.co" }, { fetcher: hanging, sendEmail: async () => undefined, budgetMs: 50 });
    expect(Date.now() - started).toBeLessThan(1000);
    vi.unstubAllEnvs();
  });

  it("carries lead details but nothing else", () => {
    const text = formatAlert("account_created", { email: "a@b.co", method: "email", source: "chat_trial", model: "Raven", stage: "email (stage 2)", utm: { utm_source: "google" }, country: "GB", phone: "+447700900000" }, new Date("2026-10-24T12:00:00Z"));
    expect(text).toContain("New account (account_created)");
    expect(text).toContain("Time: 2026-10-24 12:00:00 UTC");
    expect(text).toContain("Source: chat_trial");
    expect(text).toContain("UTM: utm_source=google");
    expect(text).not.toMatch(/password|message content/i);
  });
});

describe("unverified accounts and generator gating (8.7, 8.8)", () => {
  it("nothing but the banner and the verify link reads email_verified_at", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { if (name !== "__tests__") walk(path); continue; }
        if (/\.(ts|tsx)$/.test(name) && readFileSync(path, "utf8").includes("email_verified_at")) hits.push(path.replace(/\\/g, "/").split("/src/")[1]);
      }
    };
    walk(join(__dirname, "..", ".."));
    expect(hits.sort()).toEqual(["components/VerifyEmailBanner.tsx", "lib/verify-email.server.ts"]);
  });

  it("a guest session counts as signed out, so the generator still asks for an account", () => {
    expect(isAccount({ is_anonymous: true })).toBe(false);
    expect(isAccount({ is_anonymous: false })).toBe(true);
    expect(isAccount(null)).toBe(false);
  });

  it("validates phone numbers as E.164 and keeps everyone on the trial at split 0", () => {
    expect(isE164("+14155550123")).toBe(true);
    expect(isE164("4155550123")).toBe(false);
    expect(isE164("+0123456789")).toBe(false);
    expect(trialVariant("any-seed")).toBe("trial");
    const control = Array.from({ length: 200 }, (_, i) => trialVariant(`seed-${i}`, 0.5)).filter((v) => v === "control").length;
    expect(control).toBeGreaterThan(60);
    expect(control).toBeLessThan(140);
  });
});
