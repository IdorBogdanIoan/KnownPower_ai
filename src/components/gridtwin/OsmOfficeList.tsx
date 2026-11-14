import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Camera, ArrowUpRight } from "lucide-react";
import type { Geometry, Workspace } from "@/lib/gridtwin/model";
import { approvedOsmInspection, osmTones, osmVerdicts } from "@/lib/gridtwin/osm-inspections";
import { useAccount } from "./Account";

export function OsmOfficeList({ data, selected, onFocus, onReports }: { data: Workspace; selected?: string | undefined; onFocus: (g: Geometry) => void; onReports: () => void }) {
  const access = useAccount();
  return <>{(data.layers["osm_constanta"]?.features || []).filter(f => !selected || f.properties?.["osm_id"] === selected).map(f => {
    const id = String(f.properties?.["osm_id"]);
    const r = approvedOsmInspection(f, data.reports);
    const pending = data.reports.filter(r => r.osm_id === id && r.status === "in_asteptare").length;
    return <article className="proposal-card" key={id}>
      <div className="object-id">{id} · {String(f.properties?.["power"])}</div>
      {r?.osm_verdict && <h3 className={osmTones[r.osm_verdict]}>{osmVerdicts[r.osm_verdict]}</h3>}
      {r && <><p className="text-xs">{r.evidence_notes}</p><p className="text-xs text-muted-foreground">Inspector: {r.actor} · {new Date(r.inspected_at || r.created_at).toLocaleString("ro-RO")}<br />Aprobat: {r.decided_by} · {r.decided_at && new Date(r.decided_at).toLocaleString("ro-RO")}</p></>}
      {pending > 0 && <p className="warning text-xs">{pending} verificări în așteptare</p>}
      <div className="flex flex-wrap gap-2 mt-3">{access.submit && <Button variant="field" size="sm" asChild><Link to="/teren" search={{ osm: id }}><Camera />Verifică în teren</Link></Button>}<Button variant="outline" size="icon" aria-label={`Arată ${id} pe hartă`} onClick={() => onFocus(f.geometry)}><ArrowUpRight /></Button>{data.reports.some(r => r.osm_id === id) && <Button variant="outline" size="sm" onClick={onReports}>Dovezi și istoric</Button>}</div>
    </article>;
  })}</>;
}