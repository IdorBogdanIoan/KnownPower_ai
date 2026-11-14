import { Button } from "@/components/ui/button";
import { FileCheck, MapPin, Undo2 } from "lucide-react";
import { clientState, clientVerification } from "@/lib/gridtwin/client-documents";
import type { Proposal } from "@/lib/gridtwin/model";
export function ClientCard({ proposal:p, busy, canVerify, canUndo, onVerify,onFocus,onUndo }: { proposal:Proposal; busy:boolean; canVerify:boolean; canUndo:boolean; onVerify:()=>void; onFocus:()=>void; onUndo:()=>void }) {
  const v = clientVerification(p);
  return <article className="proposal-card" id={`proposal-${p.id}`}><h3 className="font-semibold break-words">{String(p.propus["adresa"] || p.obiect)}</h3>
    <p className={`text-xs my-2 ${p.status === "aprobat" && v["rezultat"] === "subteran" ? "safe" : v["rezultat"] ? "warning" : "text-muted-foreground"}`}>{clientState(p)}</p>
    <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy || !canVerify || p.status === "aprobat"} onClick={onVerify}><FileCheck />Verifică contractul</Button><Button size="sm" variant="outline" onClick={onFocus}><MapPin />Arată pe hartă</Button></div>
    <details className="mt-3 text-xs"><summary className="cursor-pointer text-muted-foreground">Detalii</summary><p className="mt-2">Încredere: {Math.round(p.incredere*100)}% · {p.sursa}</p><p>{p.motiv}</p><dl>{Object.entries(p.propus).map(([key,value]) => <div className="detail-line" key={key}><dt>{key.replaceAll("_"," ")}</dt><dd className="break-words">{typeof value === "object" ? JSON.stringify(value) : String(value ?? "—")}</dd></div>)}</dl>{p.status === "aprobat" && canUndo && <Button size="sm" variant="ghost" onClick={onUndo}><Undo2 />Anulează</Button>}</details>
  </article>;
}