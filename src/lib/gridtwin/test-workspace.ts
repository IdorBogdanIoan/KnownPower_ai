import { normalizeWorkspace } from "./workspace";
import proposals from "@/data/proposals.json";
import scores from "@/data/scores.json";
// Only the user's original simulated outputs; no invented inspections or live Cloud data.
export const testWorkspace = normalizeWorkspace({ layers: {}, proposals, scores: scores.features.map(f => ({ ...f.properties, geometry: f.geometry })), reports: [], audit: [] });