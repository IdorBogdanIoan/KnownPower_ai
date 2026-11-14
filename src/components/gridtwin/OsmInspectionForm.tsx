import { lazy, Suspense, useState } from "react";
import { ClientOnly, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Send, Loader2, MapPin, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { midpoint, type Position, type Workspace } from "@/lib/gridtwin/model";
import { osmInspectionSchema, osmVerdicts } from "@/lib/gridtwin/osm-inspections";
import { useOperator } from "./Shell";
const MapView = lazy(() => import("./MapView"));

export function OsmInspectionForm({ data, initialId }: { data: Workspace; initialId?: string | undefined }) {
  const features = data.layers["osm_constanta"]?.features || [];
  const actor = useOperator();
  const client = useQueryClient();
  const [id, setId] = useState(initialId || "");
  const feature = features.find(f => f.properties?.["osm_id"] === id);
  const [position, setPosition] = useState<Position | undefined>();
  const [source, setSource] = useState("Marcat pe hartă");
  const [verdict, setVerdict] = useState("");
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<File>();
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  async function submit() {
    setError("");
    if (!photo || !feature || !position) { setError("Selectează elementul, înregistrează poziția și adaugă o fotografie."); return; }
    const path = `${crypto.randomUUID()}/pole.jpg`;
    const parsed = osmInspectionSchema.safeParse({ actor, osm_id: id, osm_verdict: verdict, evidence_notes: notes, lat: position[1], lon: position[0], pos_source: source, photo_pole_url: path });
    if (!parsed.success) { setError("Completează inspectorul, eticheta și cel puțin 10 caractere de observații; poziția trebuie să fie în Constanța."); return; }
    setBusy(true);
    try {
      const uploaded = await supabase.storage.from("field-photos").upload(path, photo, { contentType: photo.type });
      if (uploaded.error) throw uploaded.error;
      const result = await supabase.rpc("submit_osm_inspection", { report: parsed.data });
      if (result.error) throw result.error;
      await client.invalidateQueries({ queryKey: ["gridtwin"] });
      setSent(true);
    } catch { setError("Verificarea nu a fost salvată. Dovezile sunt păstrate; reîncearcă."); }
    finally { setBusy(false); }
  }
  if (sent) return <section className="field-step"><CheckCircle2 className="safe" /><h2>Verificare OSM trimisă</h2><p>Eticheta așteaptă aprobarea operatorului.</p><Button asChild><Link to="/birou">Deschide biroul</Link></Button><Button variant="outline" className="ml-2" onClick={() => { setSent(false); setPhoto(undefined); setPreview(""); setNotes(""); setVerdict(""); }}>Verificare nouă</Button></section>;
  return <section className="field-step space-y-4">
    <h2>Verificare rețea OSM · Constanța</h2>
    <p className="text-xs text-muted-foreground">Evaluare vizuală documentată, nu certificare de siguranță electrică. Acces DEMO fără identitate verificată.</p>
    <label className="block"><span className="form-label">Element OSM</span><select className="form-control" aria-label="Element OSM" value={id} disabled={busy} onChange={e => { setId(e.target.value); setPosition(undefined); }}><option value="">Selectează elementul</option>{features.map(f => <option key={String(f.properties?.["osm_id"])} value={String(f.properties?.["osm_id"])}>{String(f.properties?.["osm_id"])} · {String(f.properties?.["power"])} {String(f.properties?.["name"] || "")}</option>)}</select></label>
    {initialId && !feature && <p role="alert">Elementul nu mai există în importul curent.</p>}
    {feature && <><a className="text-primary underline text-xs" href={String(feature.properties?.["source_url"])} target="_blank" rel="noreferrer">OpenStreetMap · {id}</a><div className="field-mini-map"><ClientOnly><Suspense fallback={<div className="map-loading">Se încarcă harta…</div>}><MapView mini data={data} position={position || midpoint(feature.geometry)} focus={feature.geometry} onPosition={p => { setPosition(p); setSource("Marcat pe hartă"); }} /></Suspense></ClientOnly></div></>}
    <Button variant="outline" disabled={!feature || busy} onClick={() => navigator.geolocation.getCurrentPosition(p => { setPosition([p.coords.longitude, p.coords.latitude]); setSource(`GPS · precizie ${Math.round(p.coords.accuracy)} m`); }, () => setError("GPS indisponibil. Marchează poziția pe hartă."), { enableHighAccuracy: true })}><MapPin />Înregistrează poziția GPS</Button>
    {position && <p className="position-note">{source} · {position[1]?.toFixed(6)}, {position[0]?.toFixed(6)}</p>}
    <label className="photo-input">{preview ? <img src={preview} alt="Dovadă verificare OSM" /> : <><Camera /><span>Fotografie de la elementul verificat</span></>}<input aria-label="Dovadă foto OSM" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (!file) return; if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) { setError("Alege o fotografie JPEG, PNG sau WebP de maximum 10 MB."); return; } setPhoto(file); const reader = new FileReader(); reader.onload = () => setPreview(String(reader.result)); reader.readAsDataURL(file); }} /></label>
    <fieldset><legend className="form-label">Etichetă propusă de inspector</legend><div className="flex flex-wrap gap-3">{Object.entries(osmVerdicts).map(([key, label]) => <label className="flex items-center gap-2" key={key}><input type="radio" name="osm-verdict" value={key} checked={verdict === key} disabled={busy} onChange={() => setVerdict(key)} />{label}</label>)}</div></fieldset>
    <label className="block"><span className="form-label">Dovezi și observații</span><textarea aria-label="Dovezi și observații" className="form-control min-h-28" maxLength={3000} value={notes} disabled={busy} onChange={e => setNotes(e.target.value)} /></label>
    {error && <p className="notice" role="alert">{error}</p>}
    <Button variant="field" disabled={busy || !feature || !photo || !position || !verdict || notes.trim().length < 10 || actor.trim().length < 2} onClick={() => void submit()}>{busy ? <Loader2 className="animate-spin" /> : <Send />}Trimite verificarea în birou</Button>
  </section>;
}