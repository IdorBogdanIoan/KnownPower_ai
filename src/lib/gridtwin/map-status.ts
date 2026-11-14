import { approvedOsmInspection, osmTones } from "./osm-inspections";
import { tone, type Feature, type Report } from "./model";

export const statusLabels = { safe: "Sigur", warning: "De verificat", danger: "Nesigur", primary: "Nevalidat" } as const;
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