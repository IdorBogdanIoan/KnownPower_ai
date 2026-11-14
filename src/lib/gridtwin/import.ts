import { z } from "zod";
import { geometrySchema, proposalSchema } from "./model";

export const layerNames: Record<string, string> = {
  streets: "Străzi", buildings: "Clădiri", unknown: "Zone necunoscute",
  detections: "Detecții YOLO", gis: "GIS companie",
};
export const collectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.object({
    type: z.literal("Feature"),
    id: z.union([z.string(), z.number()]).optional(),
    geometry: geometrySchema,
    properties: z.record(z.unknown()).nullable().optional(),
  }).passthrough()),
}).passthrough();

export function importTarget(name: string, fallback: string) {
  const stem = name.toLowerCase().replace(/\.(geojson|json)$/, "").replace(/ \(\d+\)$/, "");
  if (stem === "proposals" || stem === "scores") return stem;
  if (stem === "gis_company") return "gis";
  if (stem in layerNames) return stem;
  if (fallback) return fallback;
  throw new Error("Alege destinația fișierului din lista «Importă în».");
}

export function parseImport(target: string, value: unknown) {
  if (target === "proposals") {
    const input = Array.isArray(value) ? value : collectionSchema.parse(value).features.map((f) => ({
      ...f.properties, id: f.properties?.["id"] ?? f.id, geometrie: f.geometry,
    }));
    return { kind: "proposals" as const, rows: z.array(proposalSchema).parse(input) };
  }
  const collection = collectionSchema.parse(value);
  if (target === "scores") {
    const rows = collection.features.map((f) => {
      const properties = z.object({
        id: z.string(), scor: z.number().min(0).max(1),
        culoare: z.enum(["verde", "galben", "rosu"]), motive: z.array(z.string()),
      }).parse(f.properties);
      if (f.geometry.type !== "LineString") throw new Error("Scorurile trebuie să fie LineString.");
      return { ...properties, geometry: f.geometry };
    });
    return { kind: "scores" as const, rows };
  }
  if (!(target in layerNames)) throw new Error("Destinație de import nerecunoscută.");
  return { kind: "layer" as const, collection };
}

export function importError(error: unknown) {
  if (error instanceof z.ZodError) {
    const first = error.issues[0];
    return `Date invalide${first ? ` la ${first.path.join(".")}: ${first.message}` : "."}`;
  }
  if (error instanceof SyntaxError) return "Fișierul nu conține JSON valid.";
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "Import nereușit. Încearcă din nou.";
}