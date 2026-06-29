import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  amIAdmin, listUsers, adminAddCredits, adminSetSubscription, adminSetRole, adminCreateUser,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Shield, Search, UserPlus, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — HumanCrush.ai" }, { name: "robots", content: "noindex" }] }),
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

  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  // create user form
  const [nuEmail, setNuEmail] = useState("");
  const [nuPass, setNuPass] = useState("");
  const [nuName, setNuName] = useState("");

  async function load() {
    setLoading(true);
    try {
      const r = await fetchUsers({ data: { search } });
      setRows(r.users);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    (async () => {
      try {
        const r = await checkAdmin();
        setAllowed(r.isAdmin);
        if (r.isAdmin) await load();
      } finally { setReady(true); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) return <div className="p-10 text-center text-muted-foreground">Loading…</div>;
  if (!allowed) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <Shield className="mx-auto h-10 w-10 text-primary" />
        <h1 className="mt-4 font-display text-2xl">Admins only</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your account doesn't have admin access.</p>
        <Link to="/" className="mt-6 inline-block text-primary hover:underline">← Back home</Link>
      </div>
    );
  }

  async function doCredits(userId: string, delta: number) {
    try {
      await addCredits({ data: { userId, credits: delta } });
      toast.success(`${delta >= 0 ? "Added" : "Removed"} ${Math.abs(delta)} credits`);
      await load();
    } catch (e: any) { toast.error(e.message); }
  }
  async function doSub(userId: string, tier: "sub-flirt" | "sub-lover" | "sub-soulmate" | "none") {
    try {
      await setSub({ data: { userId, tier } });
      toast.success(tier === "none" ? "Subscription cleared" : `Set to ${tier}`);
      await load();
    } catch (e: any) { toast.error(e.message); }
  }
  async function doRole(userId: string, grant: boolean) {
    try {
      await setRole({ data: { userId, role: "admin", grant } });
      toast.success(grant ? "Granted admin" : "Revoked admin");
      await load();
    } catch (e: any) { toast.error(e.message); }
  }
  async function doCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createUser({ data: { email: nuEmail, password: nuPass, displayName: nuName || undefined } });
      toast.success("User created");
      setNuEmail(""); setNuPass(""); setNuName("");
      await load();
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl md:text-3xl">Admin console</h1>
          <p className="text-xs text-muted-foreground">Manage users, credits, and subscriptions.</p>
        </div>
        <Button variant="outline" onClick={() => supabase.auth.signOut().then(() => location.assign("/"))}>
          Sign out
        </Button>
      </header>

      <section className="glass mb-6 rounded-2xl p-4">
        <h2 className="mb-3 flex items-center gap-2 font-display text-lg"><UserPlus className="h-4 w-4" /> Create account</h2>
        <form onSubmit={doCreate} className="grid gap-3 md:grid-cols-4">
          <div><Label className="text-xs">Email</Label><Input required type="email" value={nuEmail} onChange={(e) => setNuEmail(e.target.value)} /></div>
          <div><Label className="text-xs">Password</Label><Input required minLength={6} type="text" value={nuPass} onChange={(e) => setNuPass(e.target.value)} /></div>
          <div><Label className="text-xs">Display name (optional)</Label><Input value={nuName} onChange={(e) => setNuName(e.target.value)} /></div>
          <div className="flex items-end"><Button type="submit" className="w-full">Create</Button></div>
        </form>
      </section>

      <section className="glass rounded-2xl p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search email or name" className="pl-9" value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()} />
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr><th className="p-2">User</th><th className="p-2">Credits</th><th className="p-2">Subscription</th><th className="p-2">Roles</th><th className="p-2">Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-t border-white/5 align-top">
                  <td className="p-2">
                    <div className="font-medium">{u.email}</div>
                    {u.displayName && <div className="text-xs text-muted-foreground">{u.displayName}</div>}
                    <div className="text-[10px] text-muted-foreground/70">{new Date(u.createdAt).toLocaleDateString()}</div>
                  </td>
                  <td className="p-2">
                    <div>Free: {u.freeCredits}</div>
                    <div>Paid: {u.paidCredits}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {[50, 200, 1000].map((n) => (
                        <Button key={n} size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => doCredits(u.id, n)}>+{n}</Button>
                      ))}
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => doCredits(u.id, -u.paidCredits)}>Zero</Button>
                    </div>
                  </td>
                  <td className="p-2">
                    <div>{u.tier ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{u.status ?? ""}</div>
                    {u.renewsAt && <div className="text-[10px] text-muted-foreground/70">renews {new Date(u.renewsAt).toLocaleDateString()}</div>}
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => doSub(u.id, "sub-flirt")}>Flirt</Button>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => doSub(u.id, "sub-lover")}>Lover</Button>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => doSub(u.id, "sub-soulmate")}>Soulmate</Button>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => doSub(u.id, "none")}>Clear</Button>
                    </div>
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {u.roles.length === 0 ? <span className="text-xs text-muted-foreground">user</span> :
                        u.roles.map((r) => <Badge key={r} variant="secondary">{r}</Badge>)}
                    </div>
                  </td>
                  <td className="p-2">
                    {u.roles.includes("admin") ? (
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => doRole(u.id, false)}>Revoke admin</Button>
                    ) : (
                      <Button size="sm" className="h-7 px-2 text-xs" onClick={() => doRole(u.id, true)}>Make admin</Button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
