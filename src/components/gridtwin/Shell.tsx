import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Activity, Map, Camera, Upload, Moon, Sun, LogOut, Settings, UserRound, ClipboardCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "./Account";
import { roleLabels } from "@/lib/gridtwin/access";
import { roleHome } from "@/lib/gridtwin/test-session";
import { Button } from "@/components/ui/button";
import { Toaster } from "sonner";
export const useOperator = () => useAccount().name;
export function AppShell({ children }: { children: ReactNode }) {
  const account = useAccount();
  const actor = account.name;
  const navigate = useNavigate();
  const client = useQueryClient();
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const theme = localStorage.getItem("gridtwin-theme") === "dark";
    setDark(theme);
    document.documentElement.classList.toggle("dark", theme);
  }, []);
  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("gridtwin-theme", next ? "dark" : "light");
  }
  return (
    <>
      <div className="app-shell">
        <header className="app-header">
          <Link to={account.roles[0] ? roleHome(account.roles[0]) : "/auth"} className="brand">
            <span className="brand-mark">
              <Activity />
            </span>
            KnownPower
          </Link>
          <nav className="header-nav">
            {account.map && <Link to="/birou" activeProps={{ className: "active" }}>
              <Map />
              Hartă
            </Link>}
            {account.validate && <Link to="/validare" activeProps={{ className: "active" }}><ClipboardCheck />Validare rapoarte</Link>}
            {account.submit && <Link to="/teren" activeProps={{ className: "active" }}>
              <Camera />
              Teren
            </Link>}
            {account.admin && <Link to="/import" activeProps={{ className: "active" }}>
              <Upload />
              Import
            </Link>}
            {account.admin && <Link to="/admin" activeProps={{ className: "active" }}><Settings />Administrare</Link>}
          </nav>
          <div className="header-right">
            <span className="live">{account.roles.map(r => roleLabels[r]).join(" · ")}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              title={dark ? "Mod luminos" : "Mod întunecat"}
              aria-label={dark ? "Mod luminos" : "Mod întunecat"}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>
            {account.test ? <><span className="actor-name text-xs flex flex-col items-start leading-tight"><span>{actor}</span><span className="text-muted-foreground">Logged as: {account.roles.map(r => roleLabels[r]).join(" · ")}</span></span><Button variant="ghost" size="icon" aria-label="Deconectare" title="Deconectare" onClick={async () => { await client.cancelQueries(); account.endTest(); await navigate({ to: "/auth", replace: true }); }}><LogOut /></Button></> : account.userId ? <><Button variant="ghost" asChild className="px-1" title="Profilul meu"><Link to="/profil">
              <span className="avatar">
                {actor
                  .split(" ")
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase() || "OP"}
              </span>
              <span className="actor-name text-xs flex flex-col items-start leading-tight"><span>{actor || "Operator"}</span><span className="text-muted-foreground">Logged as: {account.roles.map(r => roleLabels[r]).join(" · ")}</span></span>
            </Link></Button><Button variant="ghost" size="icon" aria-label="Deconectare" title="Deconectare" onClick={async () => { await client.cancelQueries(); client.clear(); await supabase.auth.signOut(); await navigate({ to: "/auth", replace: true }); }}><LogOut /></Button></> : <Button variant="outline" asChild><Link to="/auth"><UserRound />Login</Link></Button>}
          </div>
        </header>
        {children}
      </div>
      <Toaster position="top-center" richColors />
    </>
  );
}
