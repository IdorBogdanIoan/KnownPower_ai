import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Activity, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/components/gridtwin/Account";
import { roleLabels, type AppRole } from "@/lib/gridtwin/access";
import { roleHome } from "@/lib/gridtwin/test-session";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [
    { title: "Login · GridTwin" }, { name: "description", content: "Autentificare în GridTwin pentru echipele de teren, validare și administrare." },
    { property: "og:title", content: "Login · GridTwin" }, { property: "og:description", content: "Acces securizat la rețeaua GridTwin." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: Login,
});
function Login() {
  const account = useAccount();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [role, setRole] = useState<AppRole>("user");
  return <main className="page-body"><div className="mx-auto max-w-md py-16 space-y-6">
    <Activity className="text-primary size-10" /><h1 className="text-3xl font-semibold">GridTwin</h1><h2 className="text-xl">Login</h2>
    <form className="space-y-5" onSubmit={async e => { e.preventDefault(); if (name.trim().length < 2) return; account.startTest({ name: name.trim(), role }); await navigate({ to: roleHome(role), replace: true }); }}>
      <label className="block form-label">Nume<input className="form-control mt-2" autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="block form-label">Rol<select className="form-control mt-2" value={role} onChange={e => setRole(e.target.value as AppRole)}>{Object.entries(roleLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <Button className="w-full" disabled={name.trim().length < 2}><LogIn />Intră</Button>
    </form><p className="text-sm text-muted-foreground">Acces de test · fără modificări ale datelor reale.</p>
  </div></main>;
}