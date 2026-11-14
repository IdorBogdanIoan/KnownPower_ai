import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  UploadCloud,
  FileJson,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Download,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace, audit } from "@/lib/gridtwin/query";
import { importTarget, parseImport, importError, layerNames } from "@/lib/gridtwin/import";
import { useOperator } from "./Shell";
import uploadedProposals from "@/data/proposals.json";
import uploadedScores from "@/data/scores.json";
import type { Json } from "@/integrations/supabase/types";
import { OsmImport } from "./OsmImport";
export function ImportPage() {
  const data = useWorkspace();
  const actor = useOperator();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [destination, setDestination] = useState("");
  const [results, setResults] = useState<{ name: string; ok: boolean; text: string }[]>([]);
  async function importData(name: string, value: unknown) {
    const key = importTarget(name, destination);
    const parsed = parseImport(key, value);
    if (parsed.kind === "proposals") {
      const rows = parsed.rows.map((p) => ({
        ...p,
        decided_at: p.decided_at ?? null,
        decided_by: p.decided_by ?? null,
        sursa: p.sursa ?? null,
        motiv: p.motiv ?? null,
        geometrie: p.geometrie as unknown as Json,
        propus: p.propus as Json,
      }));
      const { error } = await supabase.from("proposals").upsert(rows);
      if (error) throw error;
      return `${rows.length} propuneri`;
    }
    if (parsed.kind === "scores") {
      const rows = parsed.rows.map((row) => ({ ...row, geometry: row.geometry as unknown as Json }));
      const { error } = await supabase.from("line_scores").upsert(rows);
      if (error) throw error;
      return `${rows.length} tronsoane`;
    }
    const geojson = parsed.collection;
    const { error } = await supabase
      .from("layers")
      .upsert({ name: key, geojson: geojson as unknown as Json });
    if (error) throw error;
    return `${geojson.features.length} obiecte`;
  }
  async function run(items: { name: string; value: () => Promise<unknown> }[]) {
    if (busy || !items.length) return;
    if (!actor) { toast.error("Completează numele operatorului înainte de import."); return; }
    setBusy(true);
    const out = [];
    for (const item of items) {
      try {
        const text = await importData(item.name, await item.value());
        try {
          await audit(actor, `Import ${item.name} · ${text}`);
          out.push({ name: item.name, ok: true, text });
        } catch {
          out.push({ name: item.name, ok: true, text: `${text} · Salvate, dar înregistrarea în jurnal a eșuat.` });
        }
      } catch (error) {
        out.push({
          name: item.name,
          ok: false,
          text: importError(error),
        });
      }
    }
    setResults(out);
    setBusy(false);
    await client.invalidateQueries({ queryKey: ["gridtwin"] });
    if (out.every((r) => r.ok)) toast.success("Datele au fost importate");
    else toast.error("Unele fișiere nu au putut fi importate");
  }
  const entries = [
    ...Object.entries(layerNames).map(([key, label]) => ({
      name: `${key === "gis" ? "gis_company" : key}.geojson`,
      label,
      count: data.layers[key]?.features.length,
      loaded: !!data.layers[key],
    })),
    {
      name: "proposals.json",
      label: "Propuneri de corecție",
      count: data.proposals.length,
      loaded: data.proposals.length > 0,
    },
    {
      name: "scores.geojson",
      label: "Încredere pe tronson",
      count: data.scores.length,
      loaded: data.scores.length > 0,
    },
  ];
  return (
    <main className="page-body">
      <div className="content-width">
        <div className="page-heading">
          <div>
            <h1>Import de date</h1>
            <p>Straturi GIS și rezultatele agentului GridTwin</p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/birou">
              Deschide harta <ArrowRight />
            </Link>
          </Button>
        </div>
        <div className="import-grid">
          <div>
            <OsmImport collection={data.layers["osm_constanta"]} />
            <label className="form-label mb-3">
              Importă în
              <select aria-label="Importă în" className="form-control mt-2" value={destination} disabled={busy} onChange={(e) => setDestination(e.target.value)}>
                <option value="">Recunoaștere după numele fișierului</option>
                {Object.entries(layerNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                <option value="proposals">Propuneri de corecție</option>
                <option value="scores">Încredere pe tronson</option>
              </select>
            </label>
            <label
              className="dropzone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void run(
                  Array.from(e.dataTransfer.files).map((file) => ({
                    name: file.name,
                    value: async () => JSON.parse((await file.text()).replace(/^\uFEFF/, "")),
                  })),
                );
              }}
            >
              <UploadCloud />
              <strong>{busy ? "Se importă…" : "Încarcă fișierele rețelei"}</strong>
              <span>Alege fișiere sau trage-le aici</span>
              <span className="font-mono text-[10px]">.geojson · .json</span>
              <input
                type="file"
                aria-label="Încarcă fișierele rețelei"
                multiple
                accept=".json,.geojson"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  void run(
                    files.map((file) => ({
                      name: file.name,
                      value: async () => JSON.parse((await file.text()).replace(/^\uFEFF/, "")),
                    })),
                  );
                  e.target.value = "";
                }}
              />
            </label>
            <section className="import-section">
              <h2 className="section-title">Fișierele încărcate în conversație</h2>
              <div className="file-row">
                <FileJson />
                <div>
                  <strong>proposals.json</strong>
                  <span>{uploadedProposals.length} propuneri livrate de agent</span>
                </div>
                <CheckCircle2 className="ml-auto text-safe" />
              </div>
              <div className="file-row">
                <FileJson />
                <div>
                  <strong>scores.geojson</strong>
                  <span>{uploadedScores.features.length} tronsoane evaluate</span>
                </div>
                <CheckCircle2 className="ml-auto text-safe" />
              </div>
              <Button
                className="w-full mt-4"
                disabled={busy}
                onClick={() =>
                  void run([
                    { name: "proposals.json", value: async () => uploadedProposals },
                    { name: "scores.geojson", value: async () => uploadedScores },
                  ])
                }
              >
                {busy ? <Loader2 className="animate-spin" /> : <Download />}
                {busy ? "Se importă…" : "Importă fișierele agentului"}
              </Button>
              <div className="notice">
                <AlertTriangle />
                <div>
                  Datele agentului provin
                  dintr-un scenariu simulat, conform documentației sale.
                </div>
              </div>
            </section>
            {results.length > 0 && (
              <section className="import-section" aria-live="polite">
                <h2 className="section-title">Rezultatul importului</h2>
                {results.map((r) => (
                  <div className="file-row" key={r.name}>
                    {r.ok ? (
                      <CheckCircle2 className="text-safe" />
                    ) : (
                      <AlertTriangle className="text-danger" />
                    )}
                    <div>
                      <strong>{r.name}</strong>
                      <span>{r.text}</span>
                    </div>
                  </div>
                ))}
              </section>
            )}
          </div>
          <section>
            <h2 className="section-title">Date în spațiul de lucru</h2>
            {entries.map((e) => (
              <div className="file-row" key={e.name}>
                <FileJson />
                <div>
                  <strong>{e.label}</strong>
                  <span className="font-mono text-[10px]">{e.name}</span>
                </div>
                <span className={`file-status ${e.loaded ? "loaded" : ""}`}>
                  {e.loaded ? `${e.count} obiecte` : "Neîncărcat"}
                </span>
              </div>
            ))}
            <p className="mt-5 text-xs text-muted-foreground leading-6">
              Reimportarea actualizează înregistrările cu același identificator. Deciziile rămân în
              jurnal.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
