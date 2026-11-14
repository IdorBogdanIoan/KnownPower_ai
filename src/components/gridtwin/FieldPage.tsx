import { lazy, Suspense, useState } from "react";
import { ClientOnly, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  FileImage,
  Sparkles,
  Send,
  CheckCircle2,
  MapPin,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import * as exifr from "exifr";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useWorkspace } from "@/lib/gridtwin/query";
import { extractSheet } from "@/lib/gridtwin/extract.functions";
import {
  fieldKeys,
  fieldLabels,
  midpoint,
  distanceM,
  snapToLine,
  type Reading,
  type Position,
} from "@/lib/gridtwin/model";
import { useOperator } from "./Shell";
import { Route } from "@/routes/teren";
import { OsmInspectionForm } from "./OsmInspectionForm";
const MapView = lazy(() => import("./MapView"));
async function resize(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const factor = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * factor);
  canvas.height = Math.round(bitmap.height * factor);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Fotografia nu poate fi procesată");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}
export function FieldPage() {
  const data = useWorkspace();
  const actor = useOperator();
  const read = useServerFn(extractSheet);
  const client = useQueryClient();
  const search = Route.useSearch();
  const [mode, setMode] = useState(search.osm ? "osm" : "gis");
  const gap = data.proposals.find((p) => p["tip"] === "gol_retea");
  const initial = gap
    ? midpoint(gap.geometrie)
    : midpoint(data.scores[0]?.geometry || { type: "Point", coordinates: [26.042, 44.534] });
  const [pole, setPole] = useState("");
  const [sheet, setSheet] = useState("");
  const [position, setPosition] = useState<Position>(initial);
  const [source, setSource] = useState(gap ? "Gol semnalat de agent" : "Marcat pe hartă");
  const [fields, setFields] = useState<Record<string, Reading>>(
    Object.fromEntries(fieldKeys.map((k) => [k, { valoare: null, incredere: 0 }])),
  );
  const [poleCheck, setPoleCheck] = useState<{
    valoare: boolean | null;
    incredere: number;
    tip_vizibil: string | null;
  }>({ valoare: null, incredere: 0, tip_vizibil: null });
  const [extra, setExtra] = useState<{ nume: string; valoare: string | null }[]>([]);
  const [busy, setBusy] = useState("");
  const [sent, setSent] = useState<string>();
  const [notice, setNotice] = useState("Marchează stâlpul pe hartă");
  const [error, setError] = useState("");
  async function photo(file: File | undefined, kind: string) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Alege o fotografie.");
      return;
    }
    setBusy(kind);
    try {
      const image = await resize(file);
      if (kind === "pole") {
        setPole(image);
        const gps = await exifr.gps(file).catch(() => undefined);
        if (gps && distanceM([gps.longitude, gps.latitude], initial) <= 2000) {
          setPosition([gps.longitude, gps.latitude]);
          setSource("GPS din poză");
          setNotice("");
        } else {
          setNotice("Marchează stâlpul pe hartă");
        }
      } else setSheet(image);
    } catch {
      toast.error("Fotografia nu a putut fi citită. Încearcă o imagine JPEG.");
    } finally {
      setBusy("");
    }
  }
  async function extract() {
    setBusy("ai");
    setError("");
    try {
      const result = await read({ data: { pole, sheet } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFields(result.result.campuri);
      const v = result.result.stalp_in_poza;
      setPoleCheck({
        valoare: typeof v.valoare === "boolean" ? v.valoare : null,
        incredere: v.incredere,
        tip_vizibil: v.tip_vizibil,
      });
      setExtra(result.result.alte_campuri);
      toast.success("Foaia a fost citită. Verifică valorile.");
    } catch {
      setError("Citirea AI nu a reușit. Poți completa câmpurile manual.");
    } finally {
      setBusy("");
    }
  }
  async function submit() {
    if (!pole || !sheet || !actor) return;
    setBusy("send");
    setError("");
    const id = crypto.randomUUID();
    try {
      const upload = async (image: string, name: string) => {
        const blob = await fetch(image).then((r) => r.blob());
        const path = `${id}/${name}.jpg`;
        const { error } = await supabase.storage
          .from("field-photos")
          .upload(path, blob, { contentType: "image/jpeg" });
        if (error) throw error;
        return path;
      };
      const [photo_pole_url, photo_sheet_url] = await Promise.all([
        upload(pole, "pole"),
        upload(sheet, "sheet"),
      ]);
      const report = {
        actor,
        lat: position[1],
        lon: position[0],
        pos_source: source,
        fields: {
          ...fields,
          ...Object.fromEntries(extra.map((e) => [e.nume, { valoare: e.valoare, incredere: 0 }])),
        },
        pole_check: poleCheck,
        photo_pole_url,
        photo_sheet_url,
      };
      const { data: rid, error } = await supabase.rpc("submit_field_report", {
        report: report as unknown as Json,
      });
      if (error) throw error;
      setSent(rid);
      await client.invalidateQueries({ queryKey: ["gridtwin"] });
    } catch {
      setError("Raportul nu a fost trimis. Fotografiile și câmpurile sunt păstrate; reîncearcă.");
    } finally {
      setBusy("");
    }
  }
  if (sent)
    return (
      <main className="page-body">
        <div className="field-page success-report">
          <CheckCircle2 />
          <h1>Raport trimis în birou</h1>
          <p>Raportul tău așteaptă aprobarea operatorului.</p>
          <p className="font-mono text-xs">{sent}</p>
          <Button asChild>
            <Link to="/birou">Deschide biroul</Link>
          </Button>
          <Button
            variant="outline"
            className="ml-2"
            onClick={() => {
              setSent(undefined);
              setPole("");
              setSheet("");
              setFields(
                Object.fromEntries(fieldKeys.map((k) => [k, { valoare: null, incredere: 0 }])),
              );
              setPoleCheck({ valoare: null, incredere: 0, tip_vizibil: null });
            }}
          >
            <RotateCcw />
            Raport nou
          </Button>
        </div>
      </main>
    );
  return (
    <main className="page-body">
      <div className="field-page">
        <div className="page-heading">
          <div>
            <h1>Raport din teren</h1>
            <p>{actor || "Echipă teren"} · Rețea de joasă tensiune</p>
          </div>
          <span className="demo-pill">ÎN AȘTEPTARE</span>
        </div>
        <div className="flex gap-2 mb-4">
          <Button variant={mode === "gis" ? "default" : "outline"} onClick={() => setMode("gis")}>Raport GIS</Button>
          <Button variant={mode === "osm" ? "default" : "outline"} onClick={() => setMode("osm")}>Verificare OSM</Button>
        </div>
        {mode === "osm" ? <OsmInspectionForm data={data} initialId={search.osm} /> : <>
        <section className="field-step">
          <h2 className="step-heading">
            <span className={`step-number ${pole ? "done" : ""}`}>
              {pole ? <CheckCircle2 size={14} /> : 1}
            </span>
            Poză la stâlp
          </h2>
          <label className="photo-input">
            {pole ? (
              <img src={pole} alt="Fotografia stâlpului" />
            ) : (
              <>
                <Camera />
                <span>{busy === "pole" ? "Se procesează…" : "Fotografiază sau alege o poză"}</span>
              </>
            )}
            <input
              aria-label="Poză la stâlp"
              type="file"
              accept="image/*"
              capture="environment"
              disabled={!!busy}
              onChange={(e) => void photo(e.target.files?.[0], "pole")}
            />
          </label>
          {pole && notice && (
            <div className="position-note warning">
              <MapPin size={12} className="inline mr-1" />
              {notice}
            </div>
          )}
        </section>
        <section className="field-step">
          <h2 className="step-heading">
            <span className={`step-number ${sheet ? "done" : ""}`}>
              {sheet ? <CheckCircle2 size={14} /> : 2}
            </span>
            Foaia de măsurători
          </h2>
          <label className="photo-input">
            {sheet ? (
              <img src={sheet} alt="Foaia de măsurători" />
            ) : (
              <>
                <FileImage />
                <span>Fotografiază foaia completată</span>
              </>
            )}
            <input
              aria-label="Poză la foaia de măsurători"
              type="file"
              accept="image/*"
              capture="environment"
              disabled={!!busy}
              onChange={(e) => void photo(e.target.files?.[0], "sheet")}
            />
          </label>
        </section>
        <section className="field-step">
          <h2 className="step-heading">
            <span className="step-number">3</span>Datele din foaie
          </h2>
          <Button
            variant="outline"
            className="w-full"
            disabled={!pole || !sheet || !!busy}
            onClick={() => void extract()}
          >
            {busy === "ai" ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {busy === "ai" ? "Se citește foaia…" : "Citește foaia cu AI"}
          </Button>
          {poleCheck.valoare !== null && (
            <p className="position-note">
              Stâlp în poză: {poleCheck.valoare ? "da" : "nu"} ·{" "}
              {Math.round(poleCheck.incredere * 100)}% · {poleCheck.tip_vizibil}
            </p>
          )}
          <div className="field-form-grid">
            {fieldKeys.map((k) => {
              const f = fields[k];
              return (
                <label key={k}>
                  <span className="form-label">{fieldLabels[k]}</span>
                  <input
                    className="form-control"
                    value={f?.valoare == null ? "" : String(f.valoare)}
                    onChange={(e) =>
                      setFields({
                        ...fields,
                        [k]: { valoare: e.target.value || null, incredere: 1, sursa: "manual" },
                      })
                    }
                  />
                  <span
                    className={`reading-state ${f?.sursa === "manual" || (f?.incredere ?? 0) >= 0.8 ? "sure" : f?.valoare != null ? "check" : ""}`}
                  >
                    {f?.sursa === "manual"
                      ? "corectat · manual"
                      : f?.valoare == null
                        ? "gol"
                        : (f?.incredere ?? 0) >= 0.8
                          ? "citit sigur"
                          : "de verificat"}
                  </span>
                </label>
              );
            })}
            {extra.map((e, i) => (
              <label key={i}>
                <span className="form-label">{e.nume}</span>
                <input
                  className="form-control"
                  value={e.valoare || ""}
                  onChange={(event) =>
                    setExtra(
                      extra.map((v, j) => (j === i ? { ...v, valoare: event.target.value } : v)),
                    )
                  }
                />
              </label>
            ))}
          </div>
        </section>
        <section className="field-step">
          <h2 className="step-heading">
            <span className="step-number">4</span>Unde e stâlpul?
          </h2>
          <div className="field-mini-map">
            <ClientOnly>
              <Suspense fallback={<div className="map-loading">Se încarcă harta…</div>}>
                <MapView
                  mini
                  data={data}
                  position={position}
                  onPosition={(p) => {
                    setPosition(p);
                    setSource("Marcat pe hartă");
                    setNotice("");
                  }}
                />
              </Suspense>
            </ClientOnly>
          </div>
          <div className="position-tools">
            <Button
              variant="outline"
              onClick={() => {
                const snap = snapToLine(position, data.scores);
                if (!snap) {
                  toast.error("Importă tronsoanele înainte de lipire.");
                  return;
                }
                setPosition(snap.position);
                setSource(`Lipit de ${snap.id} · mutat ${snap.distance.toFixed(1)} m`);
              }}
            >
              <MapPin />
              Lipește de cea mai apropiată linie
            </Button>
            <Button
              variant="outline"
              disabled={!gap}
              onClick={() => {
                if (!gap) return;
                setPosition(midpoint(gap.geometrie));
                setSource("Gol semnalat de agent");
              }}
            >
              Pune la golul semnalat de agent
            </Button>
          </div>
          <p className="position-note">
            {source}
            <br />
            <span className="font-mono">
              {(position[1] ?? 0).toFixed(6)}, {(position[0] ?? 0).toFixed(6)}
            </span>
          </p>
        </section>
        {error && (
          <div className="notice" role="alert">
            {error}
          </div>
        )}
        <Button
          variant="field"
          className="submit-field"
          size="lg"
          disabled={!pole || !sheet || !actor || !!busy}
          onClick={() => void submit()}
        >
          {busy === "send" ? <Loader2 className="animate-spin" /> : <Send />}
          {busy === "send" ? "Se trimite…" : "Trimite în birou"}
        </Button>
        </>}
      </div>
    </main>
  );
}
