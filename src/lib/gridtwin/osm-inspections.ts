import { z } from "zod";
import type { Feature, Report } from "./model";

export const osmVerdicts = { sigur: "Sigur", de_verificat: "De verificat", nesigur: "Nesigur" } as const;
export const osmTones = { sigur: "safe", de_verificat: "warning", nesigur: "danger" } as const;
export const osmInspectionSchema = z.object({
  actor: z.string().trim().min(2).max(100),
  osm_id: z.string().regex(/^(node|way|relation)\/\d+$/),
  osm_verdict: z.enum(["sigur", "de_verificat", "nesigur"]),
  evidence_notes: z.string().trim().min(10).max(3000),
  lat: z.number().finite().min(44.1).max(44.28),
  lon: z.number().finite().min(28.52).max(28.72),
  photo_pole_url: z.string().regex(/^[0-9a-f-]{36}\/pole\.jpg$/),
  pos_source: z.string().min(2).max(100),
});
export function approvedOsmInspection(feature: Feature, reports: Report[]) {
  return reports.filter(r => r.osm_id === feature.properties?.["osm_id"] &&
    r.status === "aprobat" && r.osm_verdict && r.osm_geometry &&
    JSON.stringify(r.osm_geometry) === JSON.stringify(feature.geometry))
    .sort((a, b) => (b.inspected_at || b.created_at).localeCompare(a.inspected_at || a.created_at) || b.id.localeCompare(a.id))[0];
}