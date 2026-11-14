import { describe, expect, it } from "vitest";
import { approvedOsmInspection, osmInspectionSchema } from "./osm-inspections";
import { endpointVerified, type Report, type Feature } from "./model";
const feature: Feature = { type: "Feature", geometry: { type: "Point", coordinates: [28.64, 44.18] }, properties: { osm_id: "node/1" } };
const input = { actor: "Inspector test", osm_id: "node/1", osm_verdict: "sigur", evidence_notes: "Observații de test documentate", lat: 44.18, lon: 28.64, photo_pole_url: "12345678-1234-1234-1234-123456789012/pole.jpg", pos_source: "GPS" };
const report: Report = { ...input, osm_verdict: "sigur", id: "r1", status: "aprobat", created_at: "2026-11-14T13:00:00Z", inspected_at: "2026-11-14T13:00:00Z", osm_geometry: feature.geometry, fields: {}, pole_check: null, photo_sheet_url: null, decided_at: "2026-11-14T14:00:00Z", decided_by: "Operator test" };
describe("OSM evidence and labels", () => {
  it.each(["sigur", "de_verificat", "nesigur"])("allows inspector verdict %s", osm_verdict => expect(osmInspectionSchema.parse({ ...input, osm_verdict }).osm_verdict).toBe(osm_verdict));
  it("requires recorded photo evidence", () => expect(osmInspectionSchema.safeParse({ ...input, photo_pole_url: "" }).success).toBe(false));
  it("requires written evidence", () => expect(osmInspectionSchema.safeParse({ ...input, evidence_notes: "" }).success).toBe(false));
  it("does not label pending inspections", () => expect(approvedOsmInspection(feature, [{ ...report, status: "in_asteptare" }])).toBeUndefined());
  it("does not label rejected inspections", () => expect(approvedOsmInspection(feature, [{ ...report, status: "respins" }])).toBeUndefined());
  it("labels only the explicitly referenced element", () => expect(approvedOsmInspection(feature, [{ ...report, osm_id: "node/2" }])).toBeUndefined());
  it("does not transfer approval to changed import geometry", () => expect(approvedOsmInspection({ ...feature, geometry: { type: "Point", coordinates: [28.65, 44.18] } }, [report])).toBeUndefined());
  it("uses the latest inspected approved evidence and undo restores the prior label", () => {
    const newer: Report = { ...report, id: "r2", osm_verdict: "nesigur", inspected_at: "2026-11-14T15:00:00Z" };
    expect(approvedOsmInspection(feature, [report, newer])?.osm_verdict).toBe("nesigur");
    expect(approvedOsmInspection(feature, [report, { ...newer, status: "in_asteptare" }])?.osm_verdict).toBe("sigur");
  });
  it("never upgrades simulated scores with an OSM inspection", () => expect(endpointVerified({ type: "LineString", coordinates: [[28.64, 44.18], [28.641, 44.18]] }, [report])).toBeUndefined());
});