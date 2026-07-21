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
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";
import { companionImage } from "@/lib/companion-images";
import { formatPrice } from "@/lib/credit-packs";
import { toast } from "sonner";
import { Shield, Search, UserPlus, RefreshCw, Receipt } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [{ title: "Admin — HumanCrush.com" }, { name: "robots", content: "noindex" }],
  }),
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
        <Button
          variant="outline"
          onClick={() => supabase.auth.signOut().then(() => location.assign("/"))}
        >
          Sign out
        </Button>
      </header>

      <Tabs defaultValue="users">
        <TabsList className="mb-4">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="personas">Personas</TabsTrigger>
          <TabsTrigger value="broadcast">Broadcast</TabsTrigger>
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
};

function PersonasPanel() {
  const fetchPersonas = useServerFn(adminListPersonas);
  const upsert = useServerFn(adminUpsertPersona);
  const regenPhoto = useServerFn(adminRegeneratePersonaPhoto);

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
            <Label className="text-xs">Image / avatar URL</Label>
            <Input
              required
              value={form.image_url}
              onChange={set("image_url")}
              placeholder="https://… or asset path"
            />
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
      </section>

      <section className="glass rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg">All personas ({personas.length})</h2>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
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
