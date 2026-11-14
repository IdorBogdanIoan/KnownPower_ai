import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { audit } from "@/lib/gridtwin/query";
import { convertOsm, osmMetadata, osmQuery, type OsmCollection } from "@/lib/gridtwin/osm";
import { fetchConstantaOsm } from "@/lib/gridtwin/osm.functions";
import type { FeatureCollection } from "@/lib/gridtwin/model";
import { useOperator } from "./Shell";
import { readTestSession, testWriteNotice } from "@/lib/gridtwin/test-session";

export function OsmImport({ collection }: { collection?: FeatureCollection | undefined }) {
  const fetchOsm = useServerFn(fetchConstantaOsm);
  const actor = useOperator();
  const client = useQueryClient();
  const [preview, setPreview] = useState<OsmCollection>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const meta = osmMetadata(collection);
  async function download() {
    if (readTestSession()) { setError(testWriteNotice); return; }
    setBusy(true);
    setError("");
    setPreview(undefined);
    try {
      setPreview(JSON.parse(await fetchOsm()) as OsmCollection);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Export indisponibil. Datele anterioare sunt păstrate.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (readTestSession()) { setError(testWriteNotice); return; }
    if (!preview || !actor) return;
    setBusy(true);
    setError("");
    try {
      const saved = {
        ...preview,
        gridtwin: { ...preview.gridtwin, importedAt: new Date().toISOString() },
      };
      const { error: failure } = await supabase
        .from("layers")
        .upsert({ name: "osm_constanta", geojson: saved as unknown as Json });
      if (failure) throw failure;
      setPreview(undefined);
      await client.invalidateQueries({ queryKey: ["gridtwin"] });
      try {
        await audit(
          actor,
          `Import OpenStreetMap Constanța · ${saved.features.length} obiecte · ${saved.gridtwin.importedAt}`,
        );
      } catch {
        setError("Rețeaua a fost importată, dar înregistrarea în jurnal a eșuat.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Importul nu a fost salvat.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="import-section">
      <h2 className="section-title">OpenStreetMap · Constanța</h2>
      <p className="text-sm text-muted-foreground mb-3">
        Infrastructură cartografiată public, nu GIS oficial. Tensiunile și racordările pot lipsi.
        Zona de studiu include municipiul și împrejurimile, nu o limită administrativă.
      </p>
      <a
        className="text-primary underline text-sm"
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
      >
        © OpenStreetMap contributors · ODbL
      </a>
      {meta && (
        <p className="text-sm my-3">
          {collection?.features.length} obiecte · Import:{" "}
          {meta.importedAt ? new Date(meta.importedAt).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" }) : "neconfirmat"}
          <br />
          Data sursei: {meta.snapshotAt || "neprecizată în export"}
        </p>
      )}
      <div className="flex flex-wrap gap-3 my-4">
        <Button disabled={busy} onClick={() => void download()}>
          {busy ? <Loader2 className="animate-spin" /> : <Download />}Caută date OSM
        </Button>
        <Button variant="outline" asChild>
          <a
            href={`https://overpass-turbo.eu/?Q=${encodeURIComponent(osmQuery)}`}
            target="_blank"
            rel="noreferrer"
          >
            Export Overpass Turbo
          </a>
        </Button>
      </div>
      <label className="form-label">
        Export OpenStreetMap / Overpass JSON
        <input
          className="form-control mt-2"
          aria-label="Încarcă export OSM"
          type="file"
          accept=".json"
          disabled={busy}
          onChange={async (e) => {
            const input = e.currentTarget;
            const file = input.files?.[0];
            if (!file) return;
            setPreview(undefined);
            setError("");
            try {
              if (file.size > 12000000) throw new Error("Export prea mare (maximum 12 MB).");
              setPreview(
                convertOsm(
                  JSON.parse(await file.text()),
                  "Export Overpass încărcat manual",
                  new Date().toISOString(),
                ),
              );
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : "Export invalid.");
            }
            input.value = "";
          }}
        />
      </label>
      {error && (
        <p role="alert" className="notice break-words">
          {error}
        </p>
      )}
      {preview && (
        <div className="mt-4 border-t border-border pt-4">
          <p>
            {preview.features.length} obiecte disponibile · {preview.gridtwin.skipped} excluse
            <br />
            Data sursei: {preview.gridtwin.snapshotAt || "neprecizată"}
          </p>
          <p className="text-sm text-muted-foreground my-3">
            Importul înlocuiește doar stratul OSM Constanța. GIS-ul companiei, scorurile și
            propunerile existente rămân separate.
          </p>
          <Button disabled={busy || !actor} onClick={() => void save()}>
            <Check />
            Confirmă importul OSM
          </Button>
        </div>
      )}
    </section>
  );
}
