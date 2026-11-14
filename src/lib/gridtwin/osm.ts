import osmtogeojson from "osmtogeojson";
import * as turf from "@turf/turf";
import { z } from "zod";
import type { FeatureCollection } from "./model";

// Rectangular study area, not an administrative boundary.
export const constantaBounds = [28.52, 44.1, 28.72, 44.28] as const;
export const osmQuery =
  '[out:json][timeout:15];nwr["power"~"^(line|minor_line|cable|substation|transformer|pole|tower)$"](44.10,28.52,44.28,28.72);out meta geom;';
const coordinate = z.number().finite();
const elementSchema = z
  .object({
    type: z.enum(["node", "way", "relation"]),
    id: z.number().int(),
    tags: z.record(z.string()).optional(),
    lat: coordinate.optional(),
    lon: coordinate.optional(),
  })
  .passthrough();
const responseSchema = z
  .object({
    elements: z.array(elementSchema).max(20000),
    remark: z.string().optional(),
    osm3s: z.object({ timestamp_osm_base: z.string().optional() }).optional(),
  })
  .passthrough();
export type OsmCollection = FeatureCollection & {
  gridtwin: {
    source: string;
    sourceUrl: string;
    endpoint: string;
    license: string;
    fetchedAt: string;
    importedAt: string | null;
    snapshotAt: string | null;
    region: string;
    skipped: number;
  };
};
export function convertOsm(input: unknown, endpoint: string, fetchedAt: string): OsmCollection {
  const raw = responseSchema.parse(input);
  if (raw.remark) throw new Error(`Export incomplet OpenStreetMap: ${raw.remark}`);
  const converted = osmtogeojson(raw, { flatProperties: true });
  const allowed = new Set([
    "line",
    "minor_line",
    "cable",
    "substation",
    "transformer",
    "pole",
    "tower",
  ]);
  const area = turf.bboxPolygon([...constantaBounds]);
  const features = converted.features
    .filter((f) => {
      if (!allowed.has(String(f.properties?.["power"]))) return false;
      if (f.properties?.["tainted"]) return false;
      try {
        const bounds = turf.bbox(f);
        if (!bounds.every(Number.isFinite)) return false;
        return turf.booleanIntersects(f, area);
      } catch {
        return false;
      }
    })
    .map((f) => {
      const p = f.properties || {};
      // Only infrastructure attributes are retained, never customer identifiers.
      const properties = Object.fromEntries(
        [
          "power",
          "name",
          "ref",
          "voltage",
          "operator",
          "location",
          "cables",
          "circuits",
          "frequency",
        ]
          .filter((k) => typeof p[k] === "string")
          .map((k) => [k, p[k]]),
      );
      const osmId = String(f.id);
      return {
        ...f,
        properties: {
          ...properties,
          osm_id: osmId,
          source_url: `https://www.openstreetmap.org/${osmId}`,
        },
      };
    });
  if (!features.length)
    throw new Error(
      "Exportul nu conține infrastructură electrică utilizabilă în zona Constanța. Importul anterior a fost păstrat.",
    );
  return {
    type: "FeatureCollection",
    features,
    gridtwin: {
      source: "OpenStreetMap",
      sourceUrl: "https://www.openstreetmap.org/copyright",
      endpoint,
      license: "ODbL · © OpenStreetMap contributors",
      fetchedAt,
      importedAt: null,
      snapshotAt: raw.osm3s?.timestamp_osm_base || null,
      region: "Constanța · zonă de studiu rectangulară",
      skipped: converted.features.length - features.length,
    },
  };
}
export function osmMetadata(collection?: FeatureCollection): OsmCollection["gridtwin"] | undefined {
  if (!collection || !("gridtwin" in collection)) return undefined;
  const meta = collection.gridtwin;
  if (!meta || typeof meta !== "object" || !("source" in meta) || meta.source !== "OpenStreetMap")
    return undefined;
  return meta as OsmCollection["gridtwin"];
}
export function osmCoverage(collection: FeatureCollection): FeatureCollection {
  const [west, south, east, north] = constantaBounds;
  const features = [];
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      const box = turf.bboxPolygon([
        west + (x * (east - west)) / 4,
        south + (y * (north - south)) / 4,
        west + ((x + 1) * (east - west)) / 4,
        south + ((y + 1) * (north - south)) / 4,
      ]);
      const lines = collection.features.filter(
        (f) =>
          ["LineString", "MultiLineString"].includes(f.geometry.type) &&
          turf.booleanIntersects(f, box),
      );
      const reason = !lines.length
        ? "Fără linii electrice cartografiate în OSM; existența rețelei rămâne necunoscută."
        : lines.some((f) => !f.properties?.["voltage"])
          ? "Linii cartografiate cu tensiune necunoscută; acoperire și atribute de verificat."
          : "Linii cartografiate; completitudinea și racordările nu sunt confirmate.";
      features.push({
        ...box,
        properties: {
          id: `OSM-${y + 1}-${x + 1}`,
          reason,
          status: !lines.length
            ? "no_lines"
            : lines.some((f) => !f.properties?.["voltage"])
              ? "missing_voltage"
              : "unverified",
        },
      });
    }
  return { type: "FeatureCollection", features };
}
