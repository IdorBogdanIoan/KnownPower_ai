import { describe, expect, it } from "vitest";
import { visibleOsm, visibleScore, visibleProposal, unsafeProposals, initialStatuses } from "./map-status";
import type { Feature, Report, Proposal, Workspace } from "./model";
const feature: Feature = { type: "Feature", geometry: { type: "Point", coordinates: [28.64,44.18] }, properties: { osm_id: "node/1" } };
const report: Report = { id: "r1", osm_id: "node/1", osm_verdict: "sigur", osm_geometry: feature.geometry, status: "aprobat", actor: "Test", created_at: "2026-11-14", lat: 44.18, lon: 28.64, fields: {}, pole_check: null, photo_pole_url: null, photo_sheet_url: null, pos_source: null, decided_at: null, decided_by: null };
describe("map status checkboxes", () => {
  const proposal: Proposal = { id: "p1", tip: "tronson_lipsa", obiect: "T1", geometrie: { type: "LineString", coordinates: [[28.64,44.18],[28.65,44.18]] }, propus: {}, status: "in_asteptare", incredere: 0.8, motiv: "", sursa: "agent", decided_at: null, decided_by: null };
  it("shows eligible proposals only with Nesigur, never Nevalidat", () => {
    expect(visibleProposal(proposal, initialStatuses)).toBe(false);
    expect(visibleProposal(proposal, { ...initialStatuses, danger: true })).toBe(true);
    expect(visibleProposal(proposal, { ...initialStatuses, primary: false, safe: true })).toBe(false);
    expect(visibleOsm([{ ...feature, geometry: proposal.geometrie }], [], { ...initialStatuses, primary: false })).toEqual([]);
  });
  it("does not confuse proposal approval with the network classification", () => {
    expect(visibleProposal({ ...proposal, status: "aprobat" }, { ...initialStatuses, primary: false, safe: true })).toBe(false);
    expect(visibleProposal({ ...proposal, status: "aprobat" }, initialStatuses)).toBe(false);
  });
  it("does not display field-flagged proposals under Partial Sigur", () => {
    expect(visibleProposal({ ...proposal, propus: { flag: "echipa_teren" } }, initialStatuses)).toBe(false);
    expect(visibleProposal({ ...proposal, propus: { flag: "echipa_teren" } }, { ...initialStatuses, warning: true })).toBe(false);
  });
  const workspace: Workspace = { layers: {}, proposals: [proposal], scores: [], reports: [], audit: [] };
  it("excludes proposals with no evaluated evidence even at high proposal confidence", () => {
    expect(unsafeProposals(workspace)).toEqual([]);
  });
  it("includes only explicitly linked Nesigur scores, excluding safe and partial scores", () => {
    for (const [scor, expected] of [[0.3, 1], [0.4, 0], [0.8, 0]] as const) {
      expect(unsafeProposals({ ...workspace, scores: [{ id: "T1", geometry: proposal.geometrie, scor, culoare: "", motive: [] }] })).toHaveLength(expected);
    }
  });
  it("uses affected IDs without inferring a link from nearby geometry", () => {
    const score = { id: "T2", geometry: { type: "Point" as const, coordinates: [28.64,44.18] }, scor: 0.2, culoare: "", motive: [] };
    expect(unsafeProposals({ ...workspace, scores: [score] })).toEqual([]);
    expect(unsafeProposals({ ...workspace, scores: [score], proposals: [{ ...proposal, propus: { tronsoane_afectate: ["T2"] } }] })).toHaveLength(1);
  });
  it("requires an approved Nesigur matching-geometry OSM inspection", () => {
    const osmWorkspace = { ...workspace, layers: { osm_constanta: { type: "FeatureCollection" as const, features: [feature] } }, proposals: [{ ...proposal, obiect: "node/1" }] };
    expect(unsafeProposals(osmWorkspace)).toEqual([]);
    expect(unsafeProposals({ ...osmWorkspace, reports: [{ ...report, osm_verdict: "nesigur", status: "in_asteptare" }] })).toEqual([]);
    expect(unsafeProposals({ ...osmWorkspace, reports: [{ ...report, osm_verdict: "nesigur" }] })).toHaveLength(1);
    expect(unsafeProposals({ ...osmWorkspace, reports: [report] })).toEqual([]);
  });
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