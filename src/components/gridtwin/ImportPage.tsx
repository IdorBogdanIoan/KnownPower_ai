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
import { proposalSchema, geometrySchema, type FeatureCollection } from "@/lib/gridtwin/model";
import { useOperator } from "./Shell";
import uploadedProposals from "@/data/proposals.json";
import uploadedScores from "@/data/scores.json";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { OsmImport } from "./OsmImport";
const layerNames: Record<string, string> = {
  streets: "Străzi",
  buildings: "Clădiri",
  unknown: "Zone necunoscute",
  detections: "Detecții YOLO",
  gis: "GIS companie",
};
const fileSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(
    z.object({
      type: z.literal("Feature"),
      geometry: geometrySchema,
      properties: z.record(z.unknown()).nullable(),
    }),
  ),
});
export function ImportPage() {
  const data = useWorkspace();
  const actor = useOperator();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ name: string; ok: boolean; text: string }[]>([]);
  async function importData(name: string, value: unknown) {
    if (name === "proposals.json") {
      const parsed = z.array(proposalSchema).parse(value);
      const rows = parsed.map((p) => ({
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
    if (name === "scores.geojson") {
      const fc = fileSchema.parse(value);
      const rows = fc.features.map((f) => {
        const p = z
          .object({
            id: z.string(),
            scor: z.number().min(0).max(1),
            culoare: z.enum(["verde", "galben", "rosu"]),
            motive: z.array(z.string()),
          })
          .parse(f.properties);
        if (f.geometry.type !== "LineString")
          throw new Error("Scorurile trebuie să fie LineString");
        return { ...p, geometry: f.geometry as unknown as Json };
      });
      const { error } = await supabase.from("line_scores").upsert(rows);
      if (error) throw error;
      return `${rows.length} tronsoane`;
    }
    let key = name.replace(".geojson", "");
    if (key === "gis_company") key = "gis";
    if (!(key in layerNames)) throw new Error("Fișier nerecunoscut");
    const geojson = fileSchema.parse(value);
    const { error } = await supabase
      .from("layers")
      .upsert({ name: key, geojson: geojson as unknown as Json });
    if (error) throw error;
    return `${geojson.features.length} obiecte`;
  }
  async function run(items: { name: string; value: () => Promise<unknown> }[]) {
    if (!actor) return;
    setBusy(true);
    const out = [];
    for (const item of items) {
      try {
        const text = await importData(item.name, await item.value());
        await audit(actor, `Import ${item.name} · ${text}`);
        out.push({ name: item.name, ok: true, text });
      } catch (error) {
        out.push({
          name: item.name,
          ok: false,
          text: error instanceof Error ? error.message : "Import nereușit",
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
              Deschide biroul <ArrowRight />
            </Link>
          </Button>
        </div>
        <div className="import-grid">
          <div>
            <OsmImport collection={data.layers["osm_constanta"]} />
            <label
              className="dropzone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void run(
                  Array.from(e.dataTransfer.files).map((file) => ({
                    name: file.name,
                    value: async () => JSON.parse(await file.text()),
                  })),
                );
              }}
            >
              <UploadCloud />
              <strong>Încarcă fișierele rețelei</strong>
              <span>Alege fișiere sau trage-le aici</span>
              <span className="font-mono text-[10px]">.geojson · .json</span>
              <input
                type="file"
                multiple
                accept=".json,.geojson"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  void run(
                    files.map((file) => ({
                      name: file.name,
                      value: async () => JSON.parse(await file.text()),
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
                  Straturile streets, buildings, unknown, detections și gis_company nu sunt în
                  fișierele primite. Încarcă-le pentru rețeaua GIS completă. Datele agentului provin
                  dintr-un scenariu simulat, conform documentației sale.
                </div>
              </div>
            </section>
            {results.length > 0 && (
              <section className="import-section">
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
