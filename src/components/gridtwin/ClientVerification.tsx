import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { FileCheck } from "lucide-react";
import { verifyClient } from "@/lib/gridtwin/client.functions";
import { clientVerification,isClient } from "@/lib/gridtwin/client-documents";
import { useAccount } from "./Account";
import type { Proposal } from "@/lib/gridtwin/model";
import { testWriteNotice } from "@/lib/gridtwin/test-session";
export function useClientVerification() {
  const account = useAccount(); const run = useServerFn(verifyClient); const client = useQueryClient();
  const [busy,setBusy] = useState<string>();
  const count = useQuery({ queryKey:["client-documents-count"], enabled:account.validate && !account.test, queryFn:async () => { const r=await supabase.from("client_documents").select("id",{count:"exact",head:true}); if(r.error) throw r.error; return r.count || 0; } });
  async function verify(p:Proposal) { if(account.test) throw new Error(testWriteNotice); if(!count.data) throw new Error("Importă întâi contractele și rapoartele"); setBusy(p.id); try { const r=await run({data:{proposalId:p.id,operator:account.name}}); await client.invalidateQueries({queryKey:["gridtwin"]}); return r; } finally { setBusy(undefined); } }
  return {busy,count,verify};
}
export function ClientBatch({proposals,verification}: {proposals:Proposal[]; verification:ReturnType<typeof useClientVerification>}) {
  const account=useAccount(); const [progress,setProgress]=useState(""); const [summary,setSummary]=useState("");
  const items=proposals.filter(p=>isClient(p) && p.status==="in_asteptare" && !clientVerification(p)["rezultat"]);
  if(!account.validate) return null;
  if(!verification.count.data) return <div className="p-3 text-xs">{account.admin ? <Button variant="outline" size="sm" asChild><Link to="/import">Importă întâi contractele și rapoartele</Link></Button> : "Importă întâi contractele și rapoartele · administratorul poate face importul"}</div>;
  return <div className="p-3"><Button size="sm" disabled={!!verification.busy || !items.length || !!progress} onClick={async()=>{let connected=0,flagged=0; setSummary(""); try {for(let i=0;i<items.length;i++){setProgress(`${i+1}/${items.length}`); const item=items[i]; if(!item) continue; const r=await verification.verify(item); if(r.rezultat==="subteran") connected++; else flagged++;} setSummary(`${connected} conectați subteran, ${flagged} trimiși la echipă`);}catch(e){setSummary(`${connected} conectați, ${flagged} trimiși · ${e instanceof Error?e.message:"Verificare oprită"}`);}finally{setProgress("");}}}><FileCheck />Verifică toți clienții ({items.length}) {progress}</Button>{summary&&<p role="status" className="text-xs mt-2">{summary}</p>}</div>;
}