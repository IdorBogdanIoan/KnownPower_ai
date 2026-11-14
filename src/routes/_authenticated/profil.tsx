import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/components/gridtwin/Account";
import { supabase } from "@/integrations/supabase/client";
import { roleLabels } from "@/lib/gridtwin/access";
export const Route = createFileRoute("/_authenticated/profil")({
  head: () => ({ meta: [{ title: "Profilul meu · GridTwin" }, { name: "description", content: "Numele, echipa și rolul contului GridTwin." }, { property: "og:title", content: "Profilul meu · GridTwin" }, { property: "og:description", content: "Datele contului și accesul acordat în GridTwin." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: Profile,
});
function Profile() {
  const account = useAccount();
  if (account.loading) return <main className="page-body">Se încarcă profilul…</main>;
  if (account.error) return <main className="page-body"><p role="alert">{account.error}</p></main>;
  return <ProfileForm key={`${account.userId}:${account.name}:${account.team}`} />;
}
function ProfileForm() {
  const account = useAccount(); const client = useQueryClient();
  const [name, setName] = useState(account.name); const [team, setTeam] = useState(account.team);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  return <main className="page-body"><div className="mx-auto max-w-lg py-8"><h1 className="text-2xl font-semibold mb-6">Profilul meu</h1>
    <form className="space-y-5" onSubmit={async e => { e.preventDefault(); setBusy(true); setMessage(""); const result = await supabase.from("profiles").upsert({ id: account.userId, display_name: name.trim(), team: team.trim() }); setBusy(false); if (result.error) setMessage("Profilul nu a fost salvat."); else { setMessage("Profil salvat."); await client.invalidateQueries({ queryKey: ["account"] }); } }}>
    <label className="block form-label">Nume și prenume<input className="form-control mt-2" required minLength={2} maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
    <label className="block form-label">Echipă<input className="form-control mt-2" required minLength={2} maxLength={100} value={team} onChange={e => setTeam(e.target.value)} /></label>
    <p className="text-sm">Rol: <strong>{account.roles.map(r => roleLabels[r]).join(", ") || "Utilizator"}</strong></p>
    <Button disabled={busy || name.trim().length < 2 || team.trim().length < 2}><Save />Salvează profilul</Button>
    {message && <p role="status">{message}</p>}
    </form><Button className="mt-6" variant="outline" asChild><Link to="/birou">Deschide harta</Link></Button>
  </div></main>;
}