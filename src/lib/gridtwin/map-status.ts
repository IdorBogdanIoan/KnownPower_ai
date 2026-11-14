import { approvedOsmInspection, osmTones } from "./osm-inspections";
import { effectiveScores, tone, type Feature, type Report, type Proposal, type Workspace } from "./model";

export const statusLabels = { safe: "Sigur", warning: "Partial Sigur", danger: "Nesigur", primary: "Nevalidat" } as const;
export type MapStatus = keyof typeof statusLabels;
export type StatusSelection = Record<MapStatus, boolean>;
export const initialStatuses: StatusSelection = { safe: false, warning: false, danger: false, primary: true };
export function osmStatus(feature: Feature, reports: Report[]): MapStatus {
  const report = approvedOsmInspection(feature, reports);
  return report?.osm_verdict ? osmTones[report.osm_verdict] : "primary";
}
export function visibleOsm(features: Feature[], reports: Report[], selected: StatusSelection) {
  return features.filter(f => selected[osmStatus(f, reports)]);
}
export function visibleScore(score: number, selected: StatusSelection) {
  return selected[tone(score)];
}
export function unvalidatedGisLines(data: Workspace) {
  return (data.layers["gis"]?.features ?? []).filter(f =>
    ["LineString", "MultiLineString"].includes(f.geometry.type) &&
    !data.scores.some(s => s.id === f.properties?.["id"] || JSON.stringify(s.geometry) === JSON.stringify(f.geometry))
  );
}
export function unsafeProposals(data: Workspace) {
  const scores = effectiveScores(data);
  return data.proposals.filter(p => {
    const osmId = p.propus["osm_id"] ?? p.obiect;
    const osm = data.layers["osm_constanta"]?.features.find(f => f.properties?.["osm_id"] === osmId);
    if (osm) return osmStatus(osm, data.reports) === "danger";
    const ids = new Set([p.obiect, ...["tronsoane_afectate", "bransamente_afectate"].flatMap(key => {
      const values = p.propus[key];
      return Array.isArray(values) ? values.filter((v): v is string => typeof v === "string") : [];
    })]);
    const linked = scores.filter(s => ids.has(s.id) || JSON.stringify(s.geometry) === JSON.stringify(p.geometrie));
    return linked.some(s => tone(s.scor) === "danger");
  });
}
export function visibleProposal(proposal: Proposal, selected: StatusSelection) {
  return proposal.status !== "respins" && selected.danger;
}