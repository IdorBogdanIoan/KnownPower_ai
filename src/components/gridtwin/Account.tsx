import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { permissions, type AppRole } from "@/lib/gridtwin/access";
import { canViewMap, readTestSession, testSessionKey, type TestSession } from "@/lib/gridtwin/test-session";

const AccountContext = createContext({ userId: "", name: "", team: "", roles: [] as AppRole[], loading: true, error: "", test: false, map: false, startTest: (_session: TestSession) => {}, endTest: () => {}, ...permissions([]) });
export const useAccount = () => useContext(AccountContext);
export function AccountProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState("");
  const [ready, setReady] = useState(false);
  const [testSession, setTestSession] = useState<TestSession | null>(null);
  const router = useRouter();
  const client = useQueryClient();
  useEffect(() => {
    let alive = true;
    setTestSession(readTestSession());
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
    queryKey: ["account", userId], enabled: !!userId && !testSession,
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
  const roles = testSession ? [testSession.role] : account.data?.roles || [];
  function startTest(session: TestSession) { sessionStorage.setItem(testSessionKey, JSON.stringify(session)); client.clear(); setTestSession(session); }
  function endTest() { sessionStorage.removeItem(testSessionKey); client.clear(); setTestSession(null); }
  return <AccountContext.Provider value={{ userId: testSession ? "" : userId, name: testSession?.name || account.data?.name || "", team: testSession ? "" : account.data?.team || "", roles, loading: !ready || (!testSession && !!userId && account.isPending), error: !testSession && account.error ? "Profilul nu a putut fi încărcat. Reîncearcă." : "", test: !!testSession, map: canViewMap(roles), startTest, endTest, ...permissions(roles) }}>{children}</AccountContext.Provider>;
}
export function AccessRequired({ kind, children }: { kind: "submit" | "validate" | "admin" | "map"; children: ReactNode }) {
  const account = useAccount();
  if (account.loading) return <main className="page-body"><p>Se verifică accesul…</p></main>;
  if (!account[kind]) return <main className="page-body"><div className="content-width"><h1>Acces restricționat</h1><p>Contul tău nu are permisiunea pentru această pagină.</p></div></main>;
  return children;
}