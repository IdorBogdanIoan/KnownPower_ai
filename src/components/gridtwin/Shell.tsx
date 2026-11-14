import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Activity, Map, Camera, Upload, Moon, Sun, LogOut, Settings, UserRound } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "./Account";
import { roleLabels } from "@/lib/gridtwin/access";
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
          <Link to="/birou" className="brand">
            <span className="brand-mark">
              <Activity />
            </span>
            GridTwin
          </Link>
          <nav className="header-nav">
            <Link to="/birou" activeProps={{ className: "active" }}>
              <Map />
              Hartă
            </Link>
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
            {account.userId ? <><Button variant="ghost" asChild className="px-1" title="Profilul meu"><Link to="/profil">
              <span className="avatar">
                {actor
                  .split(" ")
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase() || "OP"}
              </span>
              <span className="actor-name text-xs">{actor || "Operator"}</span>
            </Link></Button><Button variant="ghost" size="icon" aria-label="Deconectare" title="Deconectare" onClick={async () => { await client.cancelQueries(); client.clear(); await supabase.auth.signOut(); await navigate({ to: "/auth", replace: true }); }}><LogOut /></Button></> : <Button variant="outline" asChild><Link to="/auth"><UserRound />Login</Link></Button>}
          </div>
        </header>
        {children}
      </div>
      <Toaster position="top-center" richColors />
    </>
  );
}
