import { createFileRoute } from "@tanstack/react-router";
import { AccessRequired, useAccount } from "@/components/gridtwin/Account";
import { useWorkspace, workspaceQuery } from "@/lib/gridtwin/query";
import { Button } from "@/components/ui/button";
import { Check, X, ClipboardCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { testWriteNotice } from "@/lib/gridtwin/test-session";
export const Route = createFileRoute("/_authenticated/validare")({
  head: () => ({ meta: [{ title: "Validare rapoarte · GridTwin" }, { name: "description", content: "Verificarea și validarea datelor raportate din teren în GridTwin." }, { property: "og:title", content: "Validare rapoarte · GridTwin" }, { property: "og:description", content: "Rapoarte și decizii ale echipei de validare GridTwin." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(workspaceQuery),
  component: () => <AccessRequired kind="validate"><Reports /></AccessRequired>,
});
function Reports() {
  const data = useWorkspace(); const account = useAccount(); const client = useQueryClient();
  async function decide(id: string, decision: "aprobat" | "respins") {
    if (account.test) { toast.info(testWriteNotice); return; }
    const result = await supabase.rpc("decide_grid_item", { item_id: id, item_kind: "field", decision, operator_name: account.name });
    if (result.error) toast.error("Decizia nu a fost salvată."); else await client.invalidateQueries({ queryKey: ["gridtwin"] });
  }
  return <main className="page-body"><div className="content-width"><h1 className="text-2xl font-semibold mb-6">Validare rapoarte</h1>
    {!data.reports.length && <div className="empty-state"><ClipboardCheck /><h2>Niciun raport disponibil</h2><p>{account.test ? "Nu au fost furnizate rapoarte pentru acest test." : "Rapoartele din teren vor apărea aici."}</p></div>}
    {data.reports.map(r => <article className="proposal-card" key={r.id}><h2>{r.actor}</h2><p>{r.submitted_team} · {r.status} · {new Date(r.created_at).toLocaleString("ro-RO")}</p><p>{r.evidence_notes}</p><dl className="proposal-details">{Object.entries(r.fields).map(([key,value]) => <div className="detail-line" key={key}><dt>{key}</dt><dd>{String(value.valoare ?? "—")}</dd></div>)}</dl>{r.status === "in_asteptare" && <div className="flex gap-2"><Button variant="approve" onClick={() => void decide(r.id,"aprobat")}><Check />Aprobă</Button><Button variant="reject" onClick={() => void decide(r.id,"respins")}><X />Respinge</Button></div>}</article>)}
  </div></main>;
}