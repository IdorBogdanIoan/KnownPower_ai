import type { Workspace } from "./model";

/** Accept older hydrated payloads without letting missing collections crash a page. */
export function normalizeWorkspace(input: unknown): Workspace {
  const value: unknown = typeof input === "string" ? JSON.parse(input) : input;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Datele spațiului de lucru nu au putut fi citite.");
  }
  const data = value as Partial<Workspace>;
  return {
    layers: data.layers && typeof data.layers === "object" && !Array.isArray(data.layers)
      ? data.layers
      : {},
    proposals: Array.isArray(data.proposals) ? data.proposals : [],
    scores: Array.isArray(data.scores) ? data.scores : [],
    reports: Array.isArray(data.reports) ? data.reports : [],
    audit: Array.isArray(data.audit) ? data.audit : [],
  };
}