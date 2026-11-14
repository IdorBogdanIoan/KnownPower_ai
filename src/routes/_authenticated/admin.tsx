import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Save, Users, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AccessRequired, useAccount } from "@/components/gridtwin/Account";
import { readTestSession, testWriteNotice } from "@/lib/gridtwin/test-session";
import { supabase } from "@/integrations/supabase/client";
import { roleLabels, type AppRole } from "@/lib/gridtwin/access";
import { toast } from "sonner";
export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Administrare · KnownPower" }, { name: "description", content: "Administrarea rolurilor și configurărilor aplicației KnownPower." }, { property: "og:title", content: "Administrare · KnownPower" }, { property: "og:description", content: "Conturi, echipe și configurări KnownPower." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: () => <AccessRequired kind="admin"><Admin /></AccessRequired>,
});
function Admin() {
  const account = useAccount();
  const client = useQueryClient(); const [busy, setBusy] = useState("");
  const query = useQuery({ queryKey: ["admin-accounts"], enabled: !account.test, queryFn: async () => {
    const [profiles, roles] = await Promise.all([supabase.from("profiles").select("*"), supabase.from("user_roles").select("*")]);
    if (profiles.error) throw profiles.error; if (roles.error) throw roles.error;
    return profiles.data.map(p => ({ ...p, role: roles.data.find(r => r.user_id === p.id)?.role || "user" as AppRole }));
  } });
  return <main className="page-body"><div className="content-width space-y-8"><h1 className="text-2xl font-semibold">Administrare</h1>
    <section><h2 className="section-title flex items-center gap-2"><Users className="size-4" />Conturi și roluri</h2>
    {account.test ? <p>Accesul la conturi necesită un cont verificat.</p> : query.isPending && <p>Se încarcă…</p>}{query.error && <p role="alert">Conturile nu au putut fi încărcate.</p>}
    <div className="divide-y divide-border">{query.data?.map(p => <div key={p.id} className="flex flex-wrap gap-4 items-center py-4"><div className="flex-1 min-w-40"><strong>{p.display_name || "Profil necompletat"}</strong><p className="text-sm text-muted-foreground">{p.team || "Echipă necompletată"}</p><small className="font-mono break-all">{p.id}</small></div>
    <select className="form-control w-auto" aria-label={`Rol pentru ${p.display_name || p.id}`} value={p.role} disabled={!!busy} onChange={async e => { setBusy(p.id); const result = await supabase.rpc("set_gridtwin_role", { target_user: p.id, new_role: e.target.value as AppRole }); if (result.error) toast.error(result.error.message); else { toast.success("Rol actualizat"); await client.invalidateQueries({ queryKey: ["admin-accounts"] }); await client.invalidateQueries({ queryKey: ["account"] }); } setBusy(""); }}>
    {Object.entries(roleLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></div>)}</div></section>
    <SettingsForm />
  </div></main>;
}
function SettingsForm() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["app-settings"], queryFn: async () => { if (readTestSession()) return {}; const r = await supabase.from("app_settings").select("*"); if (r.error) throw r.error; return Object.fromEntries(r.data.map(x => [x.key,x.value])); } });
  const [saved, setSaved] = useState<string>(); const [busy, setBusy] = useState(false);
  if (query.isPending) return <p>Se încarcă configurările…</p>;
  if (query.error) return <p role="alert">Configurările nu au putut fi încărcate.</p>;
  return <section><h2 className="section-title flex items-center gap-2"><Settings className="size-4" />Configurări aplicație</h2><form key={JSON.stringify(query.data)} className="max-w-lg space-y-4" onSubmit={async e => { e.preventDefault(); if (readTestSession()) { setSaved(testWriteNotice); return; } setBusy(true); const values = new FormData(e.currentTarget); const result = await supabase.from("app_settings").upsert([ { key: "workspace_title", value: String(values.get("workspace_title") || "").trim() }, { key: "workspace_notice", value: String(values.get("workspace_notice") || "").trim() } ]); setBusy(false); if (result.error) toast.error("Configurările nu au fost salvate."); else { setSaved("Configurări salvate."); await client.invalidateQueries({ queryKey: ["app-settings"] }); } }}>
    <label className="block form-label">Denumirea spațiului de lucru<input name="workspace_title" className="form-control mt-2" maxLength={100} defaultValue={query.data?.["workspace_title"] || ""} /></label>
    <label className="block form-label">Anunț pentru echipe<textarea name="workspace_notice" className="form-control mt-2" maxLength={500} defaultValue={query.data?.["workspace_notice"] || ""} /></label>
    <Button disabled={busy}><Save />Salvează configurările</Button>{saved && <p role="status">{saved}</p>}
  </form></section>;
}