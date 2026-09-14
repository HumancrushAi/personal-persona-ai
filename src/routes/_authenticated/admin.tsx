import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  amIAdmin,
  listUsers,
  adminAddCredits,
  adminSetSubscription,
  adminSetRole,
  adminCreateUser,
  adminListUserPayments,
  adminListPersonas,
  adminUpsertPersona,
  adminRegeneratePersonaPhoto,
  adminBroadcast,
  adminUploadImage,
  adminGetSettings,
  adminUpdateSetting,
  adminRunEvalCase,
  adminSetSuspended,
  adminListCompanionMedia,
  adminAddCompanionMedia,
  adminDeleteCompanionMedia,
} from "@/lib/admin.functions";
import { adminListSupportTickets, adminReplySupportTicket } from "@/lib/support.functions";
import type { EvalResult } from "@/lib/eval-suite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AffiliatesPanel } from "@/components/admin/AffiliatesPanel";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";
import { companionImage } from "@/lib/companion-images";
import { ClipMaker } from "@/components/ClipMaker";
import { formatPrice } from "@/lib/credit-packs";
import { toast } from "sonner";
import { Shield, Search, UserPlus, RefreshCw, Receipt, LifeBuoy, Loader2 } from "lucide-react";

// Which tab the console opens on. /admin?tab=affiliates lands straight on that
// screen — a link that can be sent to someone, and on a phone the one sure way
// to reach a tab far along the row. Anything unrecognised opens Users, because
// an unknown value leaves Radix with no tab selected and a blank page.
const ADMIN_TABS = [
  "users",
  "affiliates",
  "personas",
  "broadcast",
  "clips",
  "pricing",
  "aiconfig",
  "content",
  "support",
];
function initialAdminTab(): string {
  if (typeof window === "undefined") return "users";
  const tab = new URLSearchParams(window.location.search).get("tab") ?? "";
  return ADMIN_TABS.includes(tab) ? tab : "users";
}

// Classes for every admin tab. Full-width grid cells on a phone — see the
// comment on the tab list. The pill background is a plain utility on purpose:
// under a sm: or max-sm: variant it would be emitted after the trigger's
// data-[state=active] background and hide which tab is selected.
const ADMIN_TAB =
  "w-full min-w-0 bg-white/5 px-2 py-2 text-xs sm:w-auto sm:px-3 sm:py-1 sm:text-sm";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [{ title: "Admin — HumanCrush.com" }, { name: "robots", content: "noindex" }],
  }),
  // No beforeLoad guard: the router context has no user, and on SSR the browser
  // Supabase client has no session — the component's amIAdmin check (plus
  // assertAdmin in every server fn) is the real gate.
  component: AdminPage,
});

type Row = Awaited<ReturnType<typeof listUsers>>["users"][number];

function AdminPage() {
  const checkAdmin = useServerFn(amIAdmin);
  const fetchUsers = useServerFn(listUsers);
  const addCredits = useServerFn(adminAddCredits);
  const setSub = useServerFn(adminSetSubscription);
  const setRole = useServerFn(adminSetRole);
  const createUser = useServerFn(adminCreateUser);
  const fetchPayments = useServerFn(adminListUserPayments);
  const setSuspended = useServerFn(adminSetSuspended);

  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  // create user form
  const [nuEmail, setNuEmail] = useState("");
  const [nuPass, setNuPass] = useState("");
  const [nuName, setNuName] = useState("");

  // per-user payment history expand
  const [payFor, setPayFor] = useState<string | null>(null);
  const [payData, setPayData] = useState<Awaited<ReturnType<typeof adminListUserPayments>> | null>(
    null,
  );
  async function togglePayments(userId: string) {
    if (payFor === userId) {
      setPayFor(null);
      setPayData(null);
      return;
    }
    setPayFor(userId);
    setPayData(null);
    try {
      setPayData(await fetchPayments({ data: { userId } }));
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const r = await fetchUsers({ data: { search } });
      setRows(r.users);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const r = await checkAdmin();
        setAllowed(r.isAdmin);
        if (r.isAdmin) await load();
      } finally {
        setReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) return <div className="p-10 text-center text-muted-foreground">Loading…</div>;
  if (!allowed) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <Shield className="mx-auto h-10 w-10 text-primary" />
        <h1 className="mt-4 font-display text-2xl">Admins only</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account doesn't have admin access.
        </p>
        <Link to="/" className="mt-6 inline-block text-primary hover:underline">
          ← Back home
        </Link>
      </div>
    );
  }

  async function doSuspend(userId: string, suspended: boolean) {
    try {
      await setSuspended({ data: { userId, suspended } });
      toast.success(suspended ? "Account suspended" : "Account reinstated");
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function doCredits(userId: string, delta: number) {
    try {
      await addCredits({ data: { userId, credits: delta } });
      toast.success(`${delta >= 0 ? "Added" : "Removed"} ${Math.abs(delta)} credits`);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  async function doSub(userId: string, tier: "sub-flirt" | "sub-lover" | "sub-soulmate" | "none") {
    try {
      await setSub({ data: { userId, tier } });
      toast.success(tier === "none" ? "Subscription cleared" : `Set to ${tier}`);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  async function doRole(userId: string, grant: boolean) {
    try {
      await setRole({ data: { userId, role: "admin", grant } });
      toast.success(grant ? "Granted admin" : "Revoked admin");
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  async function doCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createUser({
        data: { email: nuEmail, password: nuPass, displayName: nuName || undefined },
      });
      toast.success("User created");
      setNuEmail("");
      setNuPass("");
      setNuName("");
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl md:text-3xl">Admin console</h1>
          <p className="text-xs text-muted-foreground">Manage users, credits, and subscriptions.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild className="bg-grad-primary text-primary-foreground">
            <Link to="/studio">Promo Studio</Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => supabase.auth.signOut().then(() => location.assign("/"))}
          >
            Sign out
          </Button>
        </div>
      </header>

      <Tabs defaultValue={initialAdminTab()}>
        {/* A 3-column grid of pills on a phone, a wrapping row from sm up.

            It was a single row, and on a phone the labels were drawn on top
            of each other ("UsersAffiliatesPersons…"). The cause is the
            touch-target floor in styles.css: every button gets min-width:
            44px, which REPLACES a flex item's default minimum — its content —
            so nine tabs shrank to 44-69px while their labels needed up to
            91px. Measured in headless Chrome at phone width, not guessed.

            In a grid a tab is exactly as wide as its column, so it cannot be
            squeezed below its label, and every section is visible at once
            instead of hiding behind a sideways scroll a phone shows no bar
            for. The two long labels are shortened below sm so they fit a
            column on a narrow phone; the panels themselves keep full titles. */}
        <TabsList className="mb-4 grid h-auto w-full grid-cols-3 gap-1.5 p-1.5 sm:flex sm:flex-wrap sm:justify-start">
          <TabsTrigger value="users" className={ADMIN_TAB}>
            Users
          </TabsTrigger>
          <TabsTrigger value="affiliates" className={ADMIN_TAB}>
            Affiliates
          </TabsTrigger>
          <TabsTrigger value="personas" className={ADMIN_TAB}>
            Personas
          </TabsTrigger>
          <TabsTrigger value="broadcast" className={ADMIN_TAB}>
            Broadcast
          </TabsTrigger>
          <TabsTrigger value="clips" className={ADMIN_TAB}>
            Clips
          </TabsTrigger>
          <TabsTrigger value="pricing" className={ADMIN_TAB}>
            <span className="sm:hidden">Pricing</span>
            <span className="hidden sm:inline">Plans &amp; Pricing</span>
          </TabsTrigger>
          <TabsTrigger value="aiconfig" className={ADMIN_TAB}>
            AI Config
          </TabsTrigger>
          <TabsTrigger value="content" className={ADMIN_TAB}>
            <span className="sm:hidden">Content</span>
            <span className="hidden sm:inline">Platform Content</span>
          </TabsTrigger>
          <TabsTrigger value="support" className={ADMIN_TAB}>
            Support
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <section className="glass mb-6 rounded-2xl p-4">
            <h2 className="mb-3 flex items-center gap-2 font-display text-lg">
              <UserPlus className="h-4 w-4" /> Create account
            </h2>
            <form onSubmit={doCreate} className="grid gap-3 md:grid-cols-4">
              <div>
                <Label className="text-xs">Email</Label>
                <Input
                  required
                  type="email"
                  value={nuEmail}
                  onChange={(e) => setNuEmail(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Password</Label>
                <Input
                  required
                  minLength={6}
                  type="text"
                  value={nuPass}
                  onChange={(e) => setNuPass(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Display name (optional)</Label>
                <Input value={nuName} onChange={(e) => setNuName(e.target.value)} />
              </div>
              <div className="flex items-end">
                <Button type="submit" className="w-full">
                  Create
                </Button>
              </div>
            </form>
          </section>

          <section className="glass rounded-2xl p-4">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search email or name"
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && load()}
                />
              </div>
              <Button variant="outline" onClick={load} disabled={loading}>
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-2">User</th>
                    <th className="p-2">Credits</th>
                    <th className="p-2">Subscription</th>
                    <th className="p-2">Roles</th>
                    <th className="p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => (
                    <tr key={u.id} className="border-t border-white/5 align-top">
                      <td className="p-2">
                        <div className="font-medium">{u.email}</div>
                        {u.displayName && (
                          <div className="text-xs text-muted-foreground">{u.displayName}</div>
                        )}
                        <div className="text-[10px] text-muted-foreground/70">
                          {new Date(u.createdAt).toLocaleDateString()}
                        </div>
                        {u.isSuspended && <Badge variant="destructive">suspended</Badge>}
                      </td>
                      <td className="p-2">
                        <div>Free: {u.freeCredits}</div>
                        <div>Paid: {u.paidCredits}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {[50, 200, 1000].map((n) => (
                            <Button
                              key={n}
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={() => doCredits(u.id, n)}
                            >
                              +{n}
                            </Button>
                          ))}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => doCredits(u.id, -u.paidCredits)}
                          >
                            Zero
                          </Button>
                        </div>
                      </td>
                      <td className="p-2">
                        <div>{u.tier ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{u.status ?? ""}</div>
                        {u.renewsAt && (
                          <div className="text-[10px] text-muted-foreground/70">
                            renews {new Date(u.renewsAt).toLocaleDateString()}
                          </div>
                        )}
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => doSub(u.id, "sub-flirt")}
                          >
                            Flirt
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => doSub(u.id, "sub-lover")}
                          >
                            Lover
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => doSub(u.id, "sub-soulmate")}
                          >
                            Soulmate
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => doSub(u.id, "none")}
                          >
                            Clear
                          </Button>
                        </div>
                      </td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          {u.roles.length === 0 ? (
                            <span className="text-xs text-muted-foreground">user</span>
                          ) : (
                            u.roles.map((r) => (
                              <Badge key={r} variant="secondary">
                                {r}
                              </Badge>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="p-2">
                        <div className="flex flex-col gap-1">
                          {u.roles.includes("admin") ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={() => doRole(u.id, false)}
                            >
                              Revoke admin
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => doRole(u.id, true)}
                            >
                              Make admin
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => togglePayments(u.id)}
                          >
                            <Receipt className="mr-1 h-3 w-3" />{" "}
                            {payFor === u.id ? "Hide" : "Payments"}
                          </Button>
                          <Button
                            size="sm"
                            variant={u.isSuspended ? "outline" : "destructive"}
                            className="h-7 px-2 text-xs"
                            onClick={() => doSuspend(u.id, !u.isSuspended)}
                          >
                            {u.isSuspended ? "Unsuspend" : "Suspend"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {payFor && (
                    <tr className="border-t border-white/5 bg-white/[0.02]">
                      <td colSpan={5} className="p-3">
                        {!payData ? (
                          <div className="text-xs text-muted-foreground">Loading history…</div>
                        ) : (
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                                Payments
                              </div>
                              {payData.payments.length === 0 ? (
                                <div className="text-xs text-muted-foreground">None</div>
                              ) : (
                                payData.payments.map((t) => (
                                  <div
                                    key={t.id}
                                    className="flex justify-between border-b border-white/5 py-1 text-xs"
                                  >
                                    <span>{t.pack_name}</span>
                                    <span
                                      className={
                                        t.status === "failed" ? "text-red-400" : "text-emerald-400"
                                      }
                                    >
                                      {formatPrice(t.amount_cents)} · {t.status}
                                    </span>
                                  </div>
                                ))
                              )}
                            </div>
                            <div>
                              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                                Credit activity
                              </div>
                              {payData.ledger.length === 0 ? (
                                <div className="text-xs text-muted-foreground">None</div>
                              ) : (
                                payData.ledger.slice(0, 20).map((l) => (
                                  <div
                                    key={l.id}
                                    className="flex justify-between border-b border-white/5 py-1 text-xs"
                                  >
                                    <span>{l.reason}</span>
                                    <span className={l.delta >= 0 ? "text-emerald-400" : ""}>
                                      {l.delta >= 0 ? "+" : ""}
                                      {l.delta} → {l.balance_after}
                                    </span>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  {rows.length === 0 && !loading && (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-muted-foreground">
                        No users found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="personas">
          <PersonasPanel />
        </TabsContent>

        <TabsContent value="broadcast">
          <BroadcastPanel />
        </TabsContent>

        <TabsContent value="clips">
          <ClipMaker />
        </TabsContent>

        <TabsContent value="pricing">
          <SettingsPanel category="pricing" />
        </TabsContent>

        <TabsContent value="aiconfig">
          <SettingsPanel category="aiconfig" />
        </TabsContent>

        <TabsContent value="support">
          <SupportPanel />
        </TabsContent>

        <TabsContent value="affiliates">
          <AffiliatesPanel />
        </TabsContent>

        <TabsContent value="content">
          <SettingsPanel category="content" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type Persona = Awaited<ReturnType<typeof adminListPersonas>>["personas"][number];

const EMPTY_FORM = {
  id: undefined as string | undefined,
  name: "",
  image_url: "",
  short_bio: "",
  base_personality: "",
  tagsText: "",
  language: "en",
  status: "active" as "active" | "inactive",
  age: 21,
  ethnicity: "",
  gender: "female",
  art_style: "realistic",
  speaking_style: "",
  vocabulary_level: "casual",
  boundaries: "",
  greeting: "",
  voice_id: "alloy",
};

function PersonasPanel() {
  const fetchPersonas = useServerFn(adminListPersonas);
  const upsert = useServerFn(adminUpsertPersona);
  const regenPhoto = useServerFn(adminRegeneratePersonaPhoto);
  const uploadImg = useServerFn(adminUploadImage);
  const [uploading, setUploading] = useState(false);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const { imageUrl } = await uploadImg({ data: { dataUrl: String(reader.result) } });
        setForm((f) => ({ ...f, image_url: imageUrl }));
        toast.success("Image uploaded");
      } catch (err: any) {
        toast.error(err.message ?? "Upload failed");
      } finally {
        setUploading(false);
      }
    };
    reader.onerror = () => {
      toast.error("Could not read file");
      setUploading(false);
    };
    reader.readAsDataURL(file);
  }

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenId, setRegenId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  async function regenerate(id: string) {
    setRegenId(id);
    try {
      await regenPhoto({ data: { companionId: id } });
      toast.success("New photo generated");
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "Regenerate failed");
    } finally {
      setRegenId(null);
    }
  }

  const [regenAll, setRegenAll] = useState<{ done: number; total: number } | null>(null);

  // Regenerate every model's photo one-by-one (gender-correct + sexy via the
  // server's portrait prompt). Sequential so we don't hammer Replicate or hit a
  // serverless timeout; failures are counted but don't stop the run.
  async function regenerateAllPhotos() {
    if (regenAll) return;
    if (
      !window.confirm(
        `Regenerate photos for all ${personas.length} models? This can take a few minutes.`,
      )
    )
      return;
    const list = [...personas];
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      setRegenAll({ done: i, total: list.length });
      try {
        await regenPhoto({ data: { companionId: list[i].id } });
      } catch {
        failed++;
      }
    }
    setRegenAll(null);
    await load();
    if (failed) toast.error(`Done — ${failed} failed, retry those individually`);
    else toast.success("All photos regenerated");
  }

  async function load() {
    setLoading(true);
    try {
      setPersonas((await fetchPersonas()).personas);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  function editPersona(p: Persona) {
    setForm({
      id: p.id,
      name: p.name,
      image_url: p.image_url,
      short_bio: p.short_bio,
      base_personality: p.base_personality,
      tagsText: (p.tags ?? []).join(", "),
      language: p.language,
      status: p.status as "active" | "inactive",
      age: p.age,
      ethnicity: p.ethnicity,
      gender: p.gender,
      art_style: p.art_style,
      speaking_style: p.speaking_style ?? "",
      vocabulary_level: p.vocabulary_level ?? "casual",
      boundaries: p.boundaries ?? "",
      greeting: p.greeting ?? "",
      voice_id: p.voice_id ?? "alloy",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await upsert({
        data: {
          id: form.id,
          name: form.name,
          image_url: form.image_url,
          short_bio: form.short_bio,
          base_personality: form.base_personality,
          tags: form.tagsText
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          language: form.language,
          status: form.status,
          age: Number(form.age),
          ethnicity: form.ethnicity,
          gender: form.gender,
          art_style: form.art_style,
          speaking_style: form.speaking_style,
          vocabulary_level: form.vocabulary_level,
          boundaries: form.boundaries,
          greeting: form.greeting,
          voice_id: form.voice_id,
        },
      });
      toast.success(form.id ? "Persona updated" : "Persona created");
      setForm({ ...EMPTY_FORM });
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-6">
      <section className="glass rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg">{form.id ? "Edit persona" : "New persona"}</h2>
          <Badge variant="secondary">18+ only</Badge>
        </div>
        <form onSubmit={save} className="grid gap-3 md:grid-cols-2">
          <div>
            <Label className="text-xs">Name</Label>
            <Input required value={form.name} onChange={set("name")} />
          </div>
          <div>
            <Label className="text-xs">Photo</Label>
            <div className="flex items-center gap-3">
              {form.image_url ? (
                <img
                  src={companionImage(form.image_url)}
                  alt=""
                  className="h-14 w-14 rounded-lg object-cover"
                />
              ) : (
                <div className="grid h-14 w-14 place-items-center rounded-lg bg-white/5 text-[10px] text-muted-foreground">
                  none
                </div>
              )}
              <div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={onPickFile}
                  disabled={uploading}
                  className="text-xs file:mr-2 file:rounded-full file:border-0 file:bg-primary/20 file:px-3 file:py-1.5 file:text-xs file:text-primary"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {uploading ? "Uploading…" : "Pick from your device, or use “Regenerate photo”."}
                </p>
              </div>
            </div>
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Description (short bio)</Label>
            <Textarea required rows={2} value={form.short_bio} onChange={set("short_bio")} />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Personality prompt</Label>
            <Textarea
              required
              rows={4}
              value={form.base_personality}
              onChange={set("base_personality")}
            />
          </div>
          <div>
            <Label className="text-xs">Tags (comma separated)</Label>
            <Input
              value={form.tagsText}
              onChange={set("tagsText")}
              placeholder="flirty, gamer, shy"
            />
          </div>
          <div>
            <Label className="text-xs">Language</Label>
            <select
              className="h-9 w-full rounded-md border border-white/10 bg-transparent px-2 text-sm"
              value={form.language}
              onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code} className="bg-background">
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Ethnicity</Label>
            <Input required value={form.ethnicity} onChange={set("ethnicity")} />
          </div>
          <div>
            <Label className="text-xs">Gender</Label>
            <Input required value={form.gender} onChange={set("gender")} />
          </div>
          <div>
            <Label className="text-xs">Age (18+)</Label>
            <Input
              required
              type="number"
              min={18}
              max={99}
              value={form.age}
              onChange={(e) => setForm((f) => ({ ...f, age: Number(e.target.value) }))}
            />
          </div>
          <div>
            <Label className="text-xs">Art style</Label>
            <Input required value={form.art_style} onChange={set("art_style")} />
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <select
              className="h-9 w-full rounded-md border border-white/10 bg-transparent px-2 text-sm"
              value={form.status}
              onChange={(e) =>
                setForm((f) => ({ ...f, status: e.target.value as "active" | "inactive" }))
              }
            >
              <option value="active" className="bg-background">
                Active
              </option>
              <option value="inactive" className="bg-background">
                Inactive
              </option>
            </select>
          </div>
          <div>
            <Label className="text-xs">Speaking style</Label>
            <Input
              value={form.speaking_style}
              onChange={set("speaking_style")}
              placeholder="e.g. casual, flirty, uses emojis"
            />
          </div>
          <div>
            <Label className="text-xs">Vocabulary level</Label>
            <select
              className="h-9 w-full rounded-md border border-white/10 bg-transparent px-2 text-sm"
              value={form.vocabulary_level}
              onChange={(e) => setForm((f) => ({ ...f, vocabulary_level: e.target.value }))}
            >
              <option value="casual" className="bg-background">
                Casual / Texting
              </option>
              <option value="intellectual" className="bg-background">
                Intellectual / Formal
              </option>
              <option value="slang" className="bg-background">
                Slang / Gen Z
              </option>
            </select>
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Boundaries (topics she avoids)</Label>
            <Input
              value={form.boundaries}
              onChange={set("boundaries")}
              placeholder="e.g. political discussion, excessive violence"
            />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Greeting message (first chat message)</Label>
            <Input
              value={form.greeting}
              onChange={set("greeting")}
              placeholder="e.g. Hey babe! So glad you're here. 💖"
            />
          </div>
          <div>
            <Label className="text-xs">Voice (OpenAI TTS)</Label>
            <select
              className="h-9 w-full rounded-md border border-white/10 bg-transparent px-2 text-sm"
              value={form.voice_id}
              onChange={(e) => setForm((f) => ({ ...f, voice_id: e.target.value }))}
            >
              <option value="alloy" className="bg-background">
                Alloy
              </option>
              <option value="echo" className="bg-background">
                Echo
              </option>
              <option value="fable" className="bg-background">
                Fable
              </option>
              <option value="onyx" className="bg-background">
                Onyx
              </option>
              <option value="nova" className="bg-background">
                Nova
              </option>
              <option value="shimmer" className="bg-background">
                Shimmer
              </option>
              <option value="sage" className="bg-background">
                Sage
              </option>
              <option value="coral" className="bg-background">
                Coral
              </option>
            </select>
          </div>
          <div className="flex items-end gap-2 md:col-span-2">
            <Button type="submit" disabled={saving}>
              {form.id ? "Save changes" : "Create persona"}
            </Button>
            {form.id && (
              <Button type="button" variant="outline" onClick={() => setForm({ ...EMPTY_FORM })}>
                Cancel edit
              </Button>
            )}
          </div>
        </form>

        {form.id && <GalleryManager companionId={form.id} />}
      </section>

      <section className="glass rounded-2xl p-4">
        {/* Wraps. The title and both buttons are wider than a phone, and in a
            row that could not wrap the buttons were squeezed below their own
            labels (the touch-target note on the tab list) and pushed past the
            screen edge, where body's overflow-x: hidden made them unreachable. */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg">All personas ({personas.length})</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={regenerateAllPhotos}
              disabled={!!regenAll || loading || personas.length === 0}
            >
              {regenAll
                ? `Regenerating ${regenAll.done + 1}/${regenAll.total}…`
                : "Regenerate ALL photos"}
            </Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading || !!regenAll}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-2">Persona</th>
                <th className="p-2">Language</th>
                <th className="p-2">Tags</th>
                <th className="p-2">Status</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {personas.map((p) => (
                <tr key={p.id} className="border-t border-white/5">
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      {companionImage(p.image_url) && (
                        <img
                          src={companionImage(p.image_url)}
                          alt=""
                          width={32}
                          height={32}
                          className="h-8 w-8 rounded-full object-cover"
                        />
                      )}
                      <div>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {p.age} · {p.ethnicity}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="p-2">{p.language}</td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {(p.tags ?? []).join(", ") || "—"}
                  </td>
                  <td className="p-2">
                    <Badge variant={p.status === "active" ? "secondary" : "outline"}>
                      {p.status}
                    </Badge>
                  </td>
                  <td className="p-2">
                    <div className="flex flex-col gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => editPersona(p)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        disabled={regenId === p.id}
                        onClick={() => regenerate(p.id)}
                      >
                        {regenId === p.id ? "Generating…" : "Regenerate photo"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {personas.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground">
                    No personas yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function BroadcastPanel() {
  const broadcast = useServerFn(adminBroadcast);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [push, setPush] = useState(true);
  const [email, setEmail] = useState(false);
  const [sending, setSending] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!push && !email) {
      toast.error("Pick push, email, or both");
      return;
    }
    setSending(true);
    try {
      const r = await broadcast({
        data: { title, body, url: url || undefined, push, email },
      });
      toast.success(`Sent — push: ${r.pushSent} (failed ${r.pushFailed}), email: ${r.emailSent}`);
      setTitle("");
      setBody("");
      setUrl("");
    } catch (e: any) {
      toast.error(e.message ?? "Broadcast failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="glass max-w-xl rounded-2xl p-4">
      <h2 className="mb-1 font-display text-lg">Send a notification</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Push reaches users who enabled notifications; email reaches everyone (needs a verified
        Resend domain).
      </p>
      <form onSubmit={send} className="space-y-3">
        <div>
          <Label className="text-xs">Title</Label>
          <Input
            required
            maxLength={80}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Aria misses you 💌"
          />
        </div>
        <div>
          <Label className="text-xs">Message</Label>
          <Textarea
            required
            rows={2}
            maxLength={300}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Come back and see what she sent you…"
          />
        </div>
        <div>
          <Label className="text-xs">Link (optional)</Label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/me" />
        </div>
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} />{" "}
            Push
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />{" "}
            Email
          </label>
        </div>
        <Button type="submit" disabled={sending}>
          {sending ? "Sending…" : "Send broadcast"}
        </Button>
      </form>
    </section>
  );
}

function SettingsPanel({ category }: { category: "pricing" | "aiconfig" | "content" }) {
  const getSettings = useServerFn(adminGetSettings);
  const updateSetting = useServerFn(adminUpdateSetting);

  const [settings, setSettings] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await getSettings();
      const obj: Record<string, any> = {};
      res.settings.forEach((s) => {
        obj[s.key] = s.value;
      });
      setSettings(obj);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave(key: string, value: any) {
    setSaving(key);
    try {
      await updateSetting({ data: { key, value } });
      toast.success(`Saved setting: ${key}`);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(null);
    }
  }

  if (loading)
    return <div className="p-4 text-center text-muted-foreground">Loading settings…</div>;

  return (
    <div className="space-y-6">
      <section className="glass rounded-2xl p-4">
        <h2 className="mb-4 font-display text-lg capitalize">
          {category === "pricing"
            ? "Plans & Pricing"
            : category === "aiconfig"
              ? "AI Configuration"
              : "Platform Content"}{" "}
          Settings
        </h2>
        <div className="space-y-4">
          {category === "pricing" && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label className="text-xs mb-1 block">Standard Token Pack Price (Cents)</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      value={settings["price_pack_1_cents"] ?? "1999"}
                      onChange={(e) =>
                        setSettings({ ...settings, price_pack_1_cents: e.target.value })
                      }
                    />
                    <Button
                      onClick={() =>
                        handleSave("price_pack_1_cents", settings["price_pack_1_cents"] ?? "1999")
                      }
                      disabled={saving === "price_pack_1_cents"}
                    >
                      Save
                    </Button>
                  </div>
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Standard Token Pack Credits</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      value={settings["price_pack_1_credits"] ?? "150"}
                      onChange={(e) =>
                        setSettings({ ...settings, price_pack_1_credits: e.target.value })
                      }
                    />
                    <Button
                      onClick={() =>
                        handleSave(
                          "price_pack_1_credits",
                          settings["price_pack_1_credits"] ?? "150",
                        )
                      }
                      disabled={saving === "price_pack_1_credits"}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}

          {category === "aiconfig" && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label className="text-xs mb-1 block">Default Model Temperature</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      step="0.1"
                      value={settings["default_temperature"] ?? "0.9"}
                      onChange={(e) =>
                        setSettings({ ...settings, default_temperature: e.target.value })
                      }
                    />
                    <Button
                      onClick={() =>
                        handleSave("default_temperature", settings["default_temperature"] ?? "0.9")
                      }
                      disabled={saving === "default_temperature"}
                    >
                      Save
                    </Button>
                  </div>
                </div>

                <div>
                  <Label className="text-xs mb-1 block">Video moan volume</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={settings["video_audio_volume"] ?? "0.7"}
                      onChange={(e) =>
                        setSettings({ ...settings, video_audio_volume: e.target.value })
                      }
                    />
                    <Button
                      onClick={() =>
                        handleSave("video_audio_volume", settings["video_audio_volume"] ?? "0.7")
                      }
                      disabled={saving === "video_audio_volume"}
                    >
                      Save
                    </Button>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    0 is silent, 1 is the file as recorded, 2 is double. Applies to the next video
                    generated — existing clips keep the volume they were made with.
                  </p>
                </div>
              </div>
            </>
          )}

          {category === "aiconfig" && <EvalPanel />}

          {category === "content" && (
            <>
              <div className="space-y-4">
                <div>
                  <Label className="text-xs mb-1 block">Top Banner Announcement Text</Label>
                  <div className="flex gap-2">
                    <Input
                      value={settings["platform_banner_text"] ?? ""}
                      onChange={(e) =>
                        setSettings({ ...settings, platform_banner_text: e.target.value })
                      }
                      placeholder="e.g. 🔥 Summer Special: Double tokens on all subscription tiers!"
                    />
                    <Button
                      onClick={() =>
                        handleSave("platform_banner_text", settings["platform_banner_text"] ?? "")
                      }
                      disabled={saving === "platform_banner_text"}
                    >
                      Save
                    </Button>
                  </div>
                </div>
                <div>
                  <Label className="text-xs mb-1 block">System Status Message</Label>
                  <div className="flex gap-2">
                    <Input
                      value={settings["system_status_message"] ?? ""}
                      onChange={(e) =>
                        setSettings({ ...settings, system_status_message: e.target.value })
                      }
                      placeholder="e.g. All systems operational"
                    />
                    <Button
                      onClick={() =>
                        handleSave("system_status_message", settings["system_status_message"] ?? "")
                      }
                      disabled={saving === "system_status_message"}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

// Admin-managed public gallery for a companion (shown while editing a persona).
function GalleryManager({ companionId }: { companionId: string }) {
  const listMedia = useServerFn(adminListCompanionMedia);
  const addMedia = useServerFn(adminAddCompanionMedia);
  const deleteMedia = useServerFn(adminDeleteCompanionMedia);
  const uploadImg = useServerFn(adminUploadImage);

  const [media, setMedia] = useState<{ id: string; media_url: string; sort_order: number }[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await listMedia({ data: { companionId } });
      setMedia(res.media);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companionId]);

  function onPickGalleryFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const { imageUrl } = await uploadImg({ data: { dataUrl: String(reader.result) } });
        await addMedia({ data: { companionId, mediaUrl: imageUrl, sortOrder: media.length } });
        toast.success("Added to gallery");
        await load();
      } catch (err: any) {
        toast.error(err.message ?? "Upload failed");
      } finally {
        setBusy(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await deleteMedia({ data: { id } });
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-white/10 p-4">
      {/* Wraps, and the file picker is capped at the card's width: its
          "Choose file / No file chosen" text is wider than the space left
          beside the title on a phone. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base">Gallery ({media.length})</h3>
        <input
          type="file"
          accept="image/*"
          onChange={onPickGalleryFile}
          disabled={busy}
          className="max-w-full text-xs file:mr-2 file:rounded-full file:border-0 file:bg-primary/20 file:px-3 file:py-1.5 file:text-xs file:text-primary"
        />
      </div>
      {media.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No gallery images yet — upload a few for this companion's public profile.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {media.map((m) => (
            <div key={m.id} className="group relative overflow-hidden rounded-xl">
              <img src={m.media_url} alt="" className="aspect-[3/4] w-full object-cover" />
              <button
                type="button"
                onClick={() => remove(m.id)}
                disabled={busy}
                className="absolute right-1 top-1 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white opacity-0 transition group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Runs the persona eval suite one case at a time (each case is its own
// server-fn call so long suites can't hit a serverless timeout).
function EvalPanel() {
  const runCase = useServerFn(adminRunEvalCase);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<EvalResult[]>([]);

  async function runAll() {
    setRunning(true);
    setResults([]);
    setProgress(null);
    try {
      let index = 0;
      let total = Infinity;
      const acc: EvalResult[] = [];
      while (index < total) {
        const res = await runCase({ data: { index } });
        total = res.total;
        acc.push(res.result);
        setResults([...acc]);
        setProgress({ done: index + 1, total });
        index++;
      }
      const passed = acc.filter((r) => r.passed).length;
      toast.success(`Evals done: ${passed}/${acc.length} passed`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-white/10 p-4">
      {/* Stacks on a phone. Side by side, the paragraph took the width and the
          "Run evals" button was pushed past the screen edge, where body's
          overflow-x: hidden made it impossible to reach. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="font-display text-base">Persona Eval Suite</h3>
          <p className="text-xs text-muted-foreground">
            Runs scripted chat scenarios against the live model and scores persona consistency,
            naturalness, repetition, and safety.
          </p>
        </div>
        <Button onClick={runAll} disabled={running} className="shrink-0 self-start sm:self-auto">
          {running
            ? progress
              ? `Running ${progress.done}/${progress.total}…`
              : "Running…"
            : "Run evals"}
        </Button>
      </div>

      {results.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Test</th>
                <th className="py-1 pr-3">Latency</th>
                <th className="py-1 pr-3">Persona</th>
                <th className="py-1 pr-3">Natural</th>
                <th className="py-1 pr-3">No-repeat</th>
                <th className="py-1 pr-3">Safety</th>
                <th className="py-1">Result</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.testName} className="border-t border-white/5 align-top">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{r.testName}</div>
                    <div className="mt-0.5 max-w-md text-muted-foreground line-clamp-2">
                      {r.response}
                    </div>
                  </td>
                  <td className="py-2 pr-3">{(r.latencyMs / 1000).toFixed(1)}s</td>
                  <td className="py-2 pr-3">{r.scores.personaConsistency}/5</td>
                  <td className="py-2 pr-3">{r.scores.naturalness}/5</td>
                  <td className="py-2 pr-3">{r.scores.repetitionAvoidance}/5</td>
                  <td className="py-2 pr-3">{r.scores.safetyCompliance}/5</td>
                  <td className="py-2">
                    <Badge variant={r.passed ? "default" : "destructive"}>
                      {r.passed ? "pass" : "fail"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Support tickets raised from the widget on the landing and sign-up pages.
//
// Replying here rather than from the email inbox is what records the reply on
// the ticket and delivers it in-app and by push as well as by email. A reply
// sent straight from the inbox reaches the customer too — the alert email's
// Reply-To is their address — it just isn't recorded here.
type SupportMessage = {
  id: string;
  direction: "in" | "out";
  body: string;
  created_at: string;
};

type SupportTicket = {
  id: string;
  ref: string;
  user_id: string | null;
  email: string;
  name: string | null;
  subject: string;
  status: string;
  created_at: string;
  last_message_at: string;
  messages: SupportMessage[];
};

function SupportPanel() {
  const fetchTickets = useServerFn(adminListSupportTickets);
  const reply = useServerFn(adminReplySupportTicket);

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res: any = await fetchTickets({} as any);
      setTickets(res.tickets ?? []);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not load tickets");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function send(ticket: SupportTicket, close: boolean) {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      const res: any = await reply({
        data: { ticketId: ticket.id, body: draft.trim(), close },
      });
      // The reply is stored even when a channel fails, so a delivery problem is
      // reported without pretending the reply was lost.
      if (res.errors?.length) toast.warning(`Sent, but: ${res.errors.join("; ")}`);
      else toast.success(close ? "Replied and closed" : "Reply sent");
      setDraft("");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Reply failed");
    } finally {
      setSending(false);
    }
  }

  const visible = tickets.filter((t) => showClosed || t.status !== "closed");
  const openCount = tickets.filter((t) => t.status === "open").length;

  return (
    <section className="glass rounded-2xl p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg">
          <LifeBuoy className="h-5 w-5 text-primary" /> Support tickets
          {openCount > 0 && (
            <Badge className="bg-primary text-primary-foreground">{openCount} open</Badge>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowClosed(!showClosed)}
            className="text-xs"
          >
            {showClosed ? "Hide closed" : "Show closed"}
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={loading} className="text-xs">
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {loading && tickets.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading tickets…</p>
      )}

      {!loading && visible.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No tickets yet. They arrive from the support button on the home and sign-up pages.
        </p>
      )}

      <div className="space-y-2">
        {visible.map((t) => {
          const isOpen = openId === t.id;
          return (
            <div
              key={t.id}
              className="overflow-hidden rounded-xl border border-white/10 bg-white/5"
            >
              <button
                type="button"
                onClick={() => {
                  setOpenId(isOpen ? null : t.id);
                  setDraft("");
                }}
                className="flex w-full items-center justify-between gap-3 p-3 text-left transition-colors hover:bg-white/5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] text-primary">#{t.ref}</span>
                    <span className="truncate text-sm font-medium text-white">{t.subject}</span>
                    <Badge
                      variant={t.status === "open" ? "default" : "secondary"}
                      className="text-[9px]"
                    >
                      {t.status}
                    </Badge>
                    {!t.user_id && (
                      <Badge variant="outline" className="text-[9px] text-white/50">
                        signed out
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {t.name ? `${t.name} · ` : ""}
                    {t.email} · {new Date(t.last_message_at).toLocaleString()}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{isOpen ? "−" : "+"}</span>
              </button>

              {isOpen && (
                <div className="border-t border-white/10 p-3">
                  <div className="mb-3 space-y-2">
                    {t.messages.map((m) => (
                      <div
                        key={m.id}
                        className={`rounded-lg p-2.5 text-xs ${
                          m.direction === "in"
                            ? "border-l-2 border-white/30 bg-black/30 text-white/90"
                            : "border-l-2 border-primary bg-primary/10 text-white"
                        }`}
                      >
                        <p className="mb-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                          {m.direction === "in" ? t.email : "You"} ·{" "}
                          {new Date(m.created_at).toLocaleString()}
                        </p>
                        <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                      </div>
                    ))}
                  </div>

                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={4}
                    maxLength={4000}
                    placeholder={`Reply to ${t.email}…`}
                    className="text-xs"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => send(t, false)}
                      disabled={sending || !draft.trim()}
                      className="text-xs"
                    >
                      {sending ? (
                        <>
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Sending…
                        </>
                      ) : (
                        "Send reply"
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => send(t, true)}
                      disabled={sending || !draft.trim()}
                      className="text-xs"
                    >
                      Reply &amp; close
                    </Button>
                    <a
                      href={`mailto:${t.email}?subject=${encodeURIComponent(`Re: ${t.subject} [#${t.ref}]`)}`}
                      className="inline-flex items-center text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-primary hover:underline"
                    >
                      Open in mail app instead
                    </a>
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Sending here emails {t.email}
                    {t.user_id ? ", and also delivers in-app and by push." : "."}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
