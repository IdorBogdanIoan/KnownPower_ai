import { describe, expect, it } from "vitest";
import { visibleOsm, visibleScore, initialStatuses } from "./map-status";
import type { Feature, Report } from "./model";
const feature: Feature = { type: "Feature", geometry: { type: "Point", coordinates: [28.64,44.18] }, properties: { osm_id: "node/1" } };
const report: Report = { id: "r1", osm_id: "node/1", osm_verdict: "sigur", osm_geometry: feature.geometry, status: "aprobat", actor: "Test", created_at: "2026-11-14", lat: 44.18, lon: 28.64, fields: {}, pole_check: null, photo_pole_url: null, photo_sheet_url: null, pos_source: null, decided_at: null, decided_by: null };
describe("map status checkboxes", () => {
  it("shows only checked categories and permits Sigur plus Nesigur", () => {
    const selected = { safe: true, danger: true, warning: false, primary: false };
    expect(visibleScore(0.8, selected)).toBe(true);
    expect(visibleScore(0.2, selected)).toBe(true);
    expect(visibleScore(0.5, selected)).toBe(false);
  });
  it("hides every evaluated object when every checkbox is cleared", () => {
    expect(visibleOsm([feature], [report], { safe: false, danger: false, warning: false, primary: false })).toEqual([]);
  });
  it("keeps unapproved objects Nevalidat and never enables all categories initially", () => {
    expect(visibleOsm([feature], [{ ...report, status: "in_asteptare" }], initialStatuses)).toEqual([feature]);
    expect(visibleOsm([feature], [report], initialStatuses)).toEqual([]);
    expect(Object.values(initialStatuses).filter(Boolean)).toHaveLength(1);
  });
});