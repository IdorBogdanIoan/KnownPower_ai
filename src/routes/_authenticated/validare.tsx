import { createFileRoute } from "@tanstack/react-router";
import { AccessRequired, useAccount } from "@/components/gridtwin/Account";
import { useWorkspace, workspaceQuery } from "@/lib/gridtwin/query";
import { Button } from "@/components/ui/button";
import { Check, X, ClipboardCheck, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { testWriteNotice } from "@/lib/gridtwin/test-session";
import { ClientBatch, useClientVerification } from "@/components/gridtwin/ClientVerification";
import { ClientCard } from "@/components/gridtwin/ClientCard";
import { isClient } from "@/lib/gridtwin/client-documents";
import { unsafeProposals } from "@/lib/gridtwin/map-status";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { decideDemoReport } from "@/lib/gridtwin/demo-reports";
import { ReportPhoto } from "@/components/gridtwin/ReportPhoto";
import { fieldLabels } from "@/lib/gridtwin/model";
export const Route = createFileRoute("/_authenticated/validare")({
  head: () => ({ meta: [{ title: "Validare rapoarte · KnownPower" }, { name: "description", content: "Verificarea și validarea datelor raportate din teren în KnownPower." }, { property: "og:title", content: "Validare rapoarte · KnownPower" }, { property: "og:description", content: "Rapoarte și decizii ale echipei de validare KnownPower." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(workspaceQuery),
  component: () => <AccessRequired kind="validate"><Reports /></AccessRequired>,
});
function Reports() {
  const verification = useClientVerification(); const navigate = useNavigate();
  const data = useWorkspace(); const account = useAccount(); const client = useQueryClient();
  const [busy, setBusy] = useState<string>();
  const eligibleProposals = unsafeProposals(data);
  async function decide(id: string, decision: "aprobat" | "respins" | "in_asteptare") {
    setBusy(id);
    try {
      if (account.test) await decideDemoReport(id, decision);
      else {
        const result = await supabase.rpc("decide_grid_item", { item_id: id, item_kind: "field", decision, operator_name: account.name });
        if (result.error) throw result.error;
      }
      await client.invalidateQueries({ queryKey: ["gridtwin"] });
    } catch { toast.error("Decizia nu a fost salvată. Reîncearcă."); }
    finally { setBusy(undefined); }
  }
  return <main className="page-body"><div className="content-width"><h1 className="text-2xl font-semibold mb-6">Validare rapoarte</h1>
    <ClientBatch proposals={eligibleProposals} verification={verification} />
    <div className="grid gap-3 md:grid-cols-2">{eligibleProposals.filter(isClient).map(p => <ClientCard key={p.id} proposal={p} busy={verification.busy===p.id} canVerify={!!verification.count.data} canUndo={account.validate} onVerify={()=>void verification.verify(p).catch(e=>toast.error(e instanceof Error?e.message:"Verificare nereușită"))} onFocus={()=>{ if(account.map) void navigate({to:"/birou"}); else toast.info(`Client: ${String(p.propus["adresa"] || p.obiect)}`); }} onUndo={async()=>{if(account.test){toast.info(testWriteNotice);return;}const r=await supabase.rpc("decide_grid_item",{item_id:p.id,item_kind:"proposal",decision:"in_asteptare",operator_name:account.name});if(r.error)toast.error(r.error.message);else await client.invalidateQueries({queryKey:["gridtwin"]});}} />)}</div>
    {!data.reports.length && <div className="empty-state"><ClipboardCheck /><h2>Niciun raport disponibil</h2><p>Rapoartele din teren vor apărea aici.</p></div>}
    {data.reports.map(r => <article className="proposal-card" key={r.id}>
      <h2>{r.actor}</h2><p>{r.submitted_team ? `${r.submitted_team} · ` : ""}{r.status === "aprobat" ? "Aprobat" : r.status === "respins" ? "Respins" : "În așteptare"} · {new Date(r.created_at).toLocaleString("ro-RO")}</p>
      <p>{r.evidence_notes}</p>
      <div className="report-photos"><ReportPhoto path={r.photo_pole_url} demo={account.test} /><ReportPhoto path={r.photo_sheet_url} demo={account.test} /></div>
      <dl className="proposal-details">{Object.entries(r.fields).map(([key,value]) => <div className="detail-line" key={key}><dt>{fieldLabels[key] || key}</dt><dd>{String(value.valoare ?? "—")}</dd></div>)}</dl>
      <p className="position-note">{r.pos_source} · {r.lat.toFixed(6)}, {r.lon.toFixed(6)}</p>
      {r.status === "in_asteptare" ? <div className="flex gap-2"><Button variant="approve" disabled={busy === r.id} onClick={() => void decide(r.id,"aprobat")}><Check />Aprobă</Button><Button variant="reject" disabled={busy === r.id} onClick={() => void decide(r.id,"respins")}><X />Respinge</Button></div> : <div className="decision-info">{r.decided_by} · {r.decided_at && new Date(r.decided_at).toLocaleString("ro-RO")}<Button variant="ghost" size="sm" disabled={busy === r.id} onClick={() => void decide(r.id,"in_asteptare")}><Undo2 />Anulează</Button></div>}
    </article>)}
  </div></main>;
}