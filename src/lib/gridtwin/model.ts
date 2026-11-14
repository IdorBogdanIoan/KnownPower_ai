import { z } from "zod";
import * as turf from "@turf/turf";
import type {
  Feature,
  FeatureCollection,
  Geometry,
  LineString,
  Point,
  Polygon,
  Position,
} from "geojson";
export type { Feature, FeatureCollection, Geometry, Position };
export const labels: Record<string, string> = {
  gol_retea: "Gol în rețea",
  stalp_lipsa: "Stâlp lipsă",
  corectie_pozitie: "Poziție greșită",
  tronson_lipsa: "Tronson lipsă",
  posibil_demontat: "Posibil demontat",
  pozitie_suspecta: "Poziție suspectă",
  bransament_lipsa: "Branșament lipsă",
  verificare_teren: "Client de verificat",
  prosumator_neinregistrat: "Prosumator nou",
  atribute_lipsa: "Atribute lipsă",
};
export const types = Object.keys(labels);
export const geometrySchema: z.ZodType<Geometry> = z.custom<Geometry>((v) => {
  if (!v || typeof v !== "object" || !("type" in v)) return false;
  try {
    turf.bbox(turf.feature(v as Geometry));
    return [
      "Point",
      "MultiPoint",
      "LineString",
      "MultiLineString",
      "Polygon",
      "MultiPolygon",
    ].includes(String(v.type));
  } catch {
    return false;
  }
});
export const proposalSchema = z.object({
  id: z.string(),
  tip: z.enum([
    "gol_retea",
    "stalp_lipsa",
    "corectie_pozitie",
    "tronson_lipsa",
    "posibil_demontat",
    "pozitie_suspecta",
    "bransament_lipsa",
    "verificare_teren",
    "prosumator_neinregistrat",
    "atribute_lipsa",
  ]),
  obiect: z.string(),
  geometrie: geometrySchema,
  propus: z.record(z.unknown()),
  sursa: z.string().nullable().optional(),
  incredere: z.number().min(0).max(1),
  motiv: z.string().nullable().optional(),
  status: z.enum(["in_asteptare", "aprobat", "respins"]).default("in_asteptare"),
  decided_by: z.string().nullable().optional(),
  decided_at: z.string().nullable().optional(),
});
export type Proposal = z.infer<typeof proposalSchema>;
export type Score = {
  id: string;
  geometry: Geometry;
  scor: number;
  culoare: string;
  motive: string[];
};
export const fieldKeys = [
  "numar_stalp",
  "tip_stalp",
  "material_stalp",
  "tensiune",
  "tip_conductor",
  "sectiune_mm2",
  "lucrare",
  "data",
  "echipa",
  "observatii",
] as const;
export const fieldLabels: Record<string, string> = {
  numar_stalp: "Număr stâlp",
  tip_stalp: "Tip stâlp",
  material_stalp: "Material stâlp",
  tensiune: "Tensiune",
  tip_conductor: "Tip conductor",
  sectiune_mm2: "Secțiune (mm²)",
  lucrare: "Lucrare",
  data: "Data",
  echipa: "Echipa",
  observatii: "Observații",
};
export const valueSchema = z.object({
  valoare: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  incredere: z.number().min(0).max(1),
  sursa: z.string().optional(),
});
export const extractionSchema = z.object({
  stalp_in_poza: valueSchema.extend({ tip_vizibil: z.string().nullable() }),
  campuri: z.object(Object.fromEntries(fieldKeys.map((k) => [k, valueSchema]))),
  alte_campuri: z.array(z.object({ nume: z.string(), valoare: z.string().nullable() })),
});
export type Reading = z.infer<typeof valueSchema>;
export type Report = {
  fictional?: boolean;
  submitted_team?: string | null;
  osm_id?: string | null;
  osm_verdict?: "sigur" | "de_verificat" | "nesigur" | null;
  evidence_notes?: string | null;
  inspected_at?: string | null;
  osm_geometry?: Geometry | null;
  id: string;
  created_at: string;
  actor: string;
  status: string;
  lat: number;
  lon: number;
  pos_source: string | null;
  fields: Record<string, Reading>;
  pole_check: { valoare: boolean | null; incredere: number; tip_vizibil?: string | null } | null;
  photo_pole_url: string | null;
  photo_sheet_url: string | null;
  decided_by: string | null;
  decided_at: string | null;
};
export type Audit = { id: string; at: string; actor: string; text: string };
export type Workspace = {
  layers: Record<string, FeatureCollection>;
  proposals: Proposal[];
  scores: Score[];
  reports: Report[];
  audit: Audit[];
};
export type Inspection = {
  id: string;
  geometry: Geometry;
  scor: number;
  motive: string[];
  unknown?: boolean;
  kind: "line" | "cell";
};
export const emptyCollection: FeatureCollection = { type: "FeatureCollection", features: [] };
export function tone(score: number) {
  return score >= 0.7 ? "safe" : score >= 0.4 ? "warning" : "danger";
}
export function distanceM(a: Position, b: Position) {
  return turf.distance(turf.point(a), turf.point(b), { units: "meters" });
}
export function midpoint(geometry: Geometry): Position {
  if (geometry.type === "Point") return geometry.coordinates;
  if (geometry.type === "LineString")
    return turf.along(geometry, turf.length(turf.feature(geometry)) / 2).geometry.coordinates;
  return turf.center(turf.feature(geometry)).geometry.coordinates;
}
export function nearby(geometry: Geometry, point: Position, meters: number) {
  if (geometry.type === "LineString")
    return turf.pointToLineDistance(turf.point(point), geometry, { units: "meters" }) < meters;
  return distanceM(midpoint(geometry), point) < meters;
}
export function endpointVerified(geometry: Geometry, reports: Report[]) {
  if (geometry.type !== "LineString") return undefined;
  return reports.find(
    (r) =>
      r.status === "aprobat" &&
      !r.osm_id &&
      [geometry.coordinates[0], geometry.coordinates.at(-1)].some(
        (p) => p && distanceM(p, [r.lon, r.lat]) < 25,
      ),
  );
}
export function effectiveScores(data: Workspace): Score[] {
  return data.scores.map((s) => {
    const r = endpointVerified(s.geometry, data.reports);
    return r
      ? {
          ...s,
          scor: 1,
          culoare: "verde",
          motive: [
            ...s.motive,
            `verificat în teren ${new Date(r.decided_at || r.created_at).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })}`,
          ],
        }
      : s;
  });
}
export function zoneScore(scores: number[], pending: number, approved: boolean) {
  return approved
    ? 1
    : Math.max(
        0,
        (scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0) -
          Math.min(0.3, pending * 0.1),
      );
}
export function confidenceCells(data: Workspace): Inspection[] {
  const streets = data.layers["streets"];
  const basis = streets?.features.length
    ? streets
    : turf.featureCollection(data.scores.map((s) => turf.feature(s.geometry)));
  if (!basis.features.length) return [];
  const bounds = turf.bbox(basis);
  if ((bounds[2] - bounds[0]) * (bounds[3] - bounds[1]) > 0.04) return [];
  const grid = turf.squareGrid(bounds, 0.05, { units: "kilometers" });
  const scores = effectiveScores(data);
  const poles =
    data.layers["gis"]?.features.filter((f) => f.properties?.["kind"] === "stalp") || [];
  return grid.features.flatMap((cell, i) => {
    const intersect = scores.filter((s) => turf.booleanIntersects(cell, turf.feature(s.geometry)));
    if (!intersect.length && !poles.some((p) => turf.booleanIntersects(cell, p))) return [];
    const pending = data.proposals.filter(
      (p) =>
        p["status"] === "in_asteptare" &&
        turf.booleanPointInPolygon(turf.point(midpoint(p["geometrie"])), cell),
    );
    const approved = data.reports.some(
       (r) => !r.osm_id && r.status === "aprobat" && turf.booleanPointInPolygon([r.lon, r.lat], cell),
    );
    const unknown = data.layers["unknown"]?.features.some((f) => turf.booleanIntersects(f, cell));
    return [
      {
        id: `Z${String(i + 1).padStart(3, "0")}`,
        geometry: cell.geometry,
        scor: zoneScore(
          intersect.map((s) => s.scor),
          pending.length,
          approved,
        ),
        motive: approved
          ? ["verificat în teren azi"]
          : [
              ...new Set(intersect.flatMap((s) => s.motive)),
              ...pending.map((p) => `${p["id"]}: schimbare neconfirmată`),
            ],
        unknown: !!unknown,
        kind: "cell" as const,
      },
    ];
  });
}
export function sortedProposals(proposals: Proposal[]) {
  return [...proposals].sort(
    (a, b) =>
      (a.status === "in_asteptare" ? 0 : 1) - (b.status === "in_asteptare" ? 0 : 1) ||
      types.indexOf(a.tip) - types.indexOf(b.tip) ||
      b.incredere - a.incredere,
  );
}
export function inferred(
  p: Proposal | undefined,
  key: string,
): { value: unknown; confidence: number; examples: unknown } {
  const v = p?.["propus"][key];
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return {
      value: o["valoare"] ?? o["value"],
      confidence: Number(o["incredere"] ?? o["confidence"] ?? p?.["incredere"] ?? 0),
      examples: o["exemple"] ?? o["examples"],
    };
  }
  return { value: v, confidence: p?.["incredere"] || 0, examples: null };
}
export function conductor(data: Workspace, id: string) {
  const feature = data.layers["gis"]?.features.find((f) => f.properties?.["id"] === id);
  const p = data.proposals.find(
    (p) => p["tip"] === "atribute_lipsa" && p["obiect"] === id && p["status"] !== "respins",
  );
  const line = data.scores.find((s) => s.id === id);
  const r = line && endpointVerified(line.geometry, data.reports);
  return ["conductor_type", "section_mm2", "material"].map((key) => {
    const fieldKey =
      key === "section_mm2"
        ? "sectiune_mm2"
        : key === "material"
          ? "material_stalp"
          : "tip_conductor";
    const field = r?.fields[fieldKey]?.valoare;
    const gis = feature?.properties?.[key];
    const v = inferred(p, key);
    return {
      key,
      value: field ?? gis ?? v.value ?? null,
      source:
        field != null
          ? "teren"
          : gis != null
            ? "GIS companie"
            : p?.["status"] === "aprobat"
              ? "aprobat"
              : `dedus de agent, ${Math.round(v.confidence * 100)}%`,
      inferred: field == null && gis == null && v.value != null,
      approved: p?.["status"] === "aprobat",
      confidence: v.confidence,
    };
  });
}
export function snapToLine(pos: Position, scores: Score[]) {
  let best: { position: Position; id: string; distance: number } | undefined;
  for (const s of scores) {
    if (s.geometry.type !== "LineString") continue;
    const snapped = turf.nearestPointOnLine(s.geometry, pos, { units: "meters" });
    const d = Number(snapped.properties["dist"]);
    if (!best || d < best.distance)
      best = { position: snapped.geometry.coordinates, id: s.id, distance: d };
  }
  return best;
}
