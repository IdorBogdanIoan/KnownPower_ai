import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Activity, LogIn, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lovable } from "@/integrations/lovable";
import { useAccount } from "@/components/gridtwin/Account";

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
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { if (account.userId && !account.loading && !account.error) void navigate({ to: account.name.trim().length >= 2 && account.team.trim().length >= 2 ? "/birou" : "/profil", replace: true }); }, [account.userId, account.loading, account.error, account.name, account.team, navigate]);
  async function login(provider: "google" | "lovable") {
    setBusy(provider); setError("");
    try {
      const result = await lovable.auth.signInWithOAuth(provider, { redirect_uri: `${window.location.origin}/auth` });
      if (result.error) throw result.error;
    } catch { setError("Autentificarea nu a reușit. Încearcă din nou."); }
    finally { setBusy(""); }
  }
  return <main className="page-body"><div className="mx-auto max-w-md py-16 space-y-6">
    <Activity className="text-primary size-10" /><h1 className="text-3xl font-semibold">GridTwin</h1><h2 className="text-xl">Autentificare</h2>
    <div className="space-y-3"><Button className="w-full" disabled={!!busy} onClick={() => void login("google")}>{busy === "google" ? <Loader2 className="animate-spin" /> : <LogIn />}Continuă cu Google</Button>
    <Button variant="outline" className="w-full" disabled={!!busy} onClick={() => void login("lovable")}>{busy === "lovable" ? <Loader2 className="animate-spin" /> : <LogIn />}Continuă cu Lovable</Button></div>
    {(error || account.error) && <p role="alert" className="text-destructive">{error || account.error}</p>}
    {account.userId && <Button asChild variant="outline"><Link to="/profil">Profilul meu</Link></Button>}
  </div></main>;
}