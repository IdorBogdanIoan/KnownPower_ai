import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { permissions, type AppRole } from "@/lib/gridtwin/access";

const AccountContext = createContext({ userId: "", name: "", team: "", roles: [] as AppRole[], loading: true, error: "", ...permissions([]) });
export const useAccount = () => useContext(AccountContext);
export function AccountProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState("");
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const client = useQueryClient();
  useEffect(() => {
    let alive = true;
    void supabase.auth.getUser().then(({ data }) => { if (alive) { setUserId(data.user?.id || ""); setReady(true); } });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"].includes(event)) return;
      setUserId(session?.user.id || "");
      setReady(true);
      if (event === "SIGNED_OUT") { void client.cancelQueries(); client.clear(); }
      else void client.invalidateQueries();
      void router.invalidate();
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [client, router]);
  const account = useQuery({
    queryKey: ["account", userId], enabled: !!userId,
    queryFn: async () => {
      const [profile, roles] = await Promise.all([
        supabase.from("profiles").select("display_name,team").eq("id", userId).single(),
        supabase.from("user_roles").select("role").eq("user_id", userId),
      ]);
      if (profile.error) throw profile.error;
      if (roles.error) throw roles.error;
      return { name: profile.data.display_name, team: profile.data.team, roles: roles.data.map(r => r.role) };
    }, refetchInterval: 15000,
  });
  const roles = account.data?.roles || [];
  return <AccountContext.Provider value={{ userId, name: account.data?.name || "", team: account.data?.team || "", roles, loading: !ready || (!!userId && account.isPending), error: account.error ? "Profilul nu a putut fi încărcat. Reîncearcă." : "", ...permissions(roles) }}>{children}</AccountContext.Provider>;
}
export function AccessRequired({ kind, children }: { kind: "submit" | "validate" | "admin"; children: ReactNode }) {
  const account = useAccount();
  if (account.loading) return <main className="page-body"><p>Se verifică accesul…</p></main>;
  if (!account[kind]) return <main className="page-body"><div className="content-width"><h1>Acces restricționat</h1><p>Contul tău nu are permisiunea pentru această pagină.</p></div></main>;
  return children;
}