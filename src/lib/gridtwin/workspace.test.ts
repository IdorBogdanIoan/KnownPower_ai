import { describe, expect, it } from "vitest";
import { normalizeWorkspace } from "./workspace";

describe("Workspace payload recovery", () => {
  it("provides empty collections for a payload without layers", () => {
    const result = normalizeWorkspace({ proposals: [{ id: "P014" }] });
    expect(result.layers).toEqual({});
    expect(result.scores).toEqual([]);
    expect(result.reports).toEqual([]);
    expect(result.audit).toEqual([]);
    expect(result.proposals).toEqual([{ id: "P014" }]);
  });
  it("decodes a string payload retained by an older hydrated cache", () => {
    const result = normalizeWorkspace(JSON.stringify({ layers: {}, proposals: [] }));
    expect(result.layers).toEqual({});
    expect(result.proposals).toEqual([]);
  });
  it("does not invent records when cached collections are null", () => {
    expect(normalizeWorkspace({ layers: null, proposals: null })).toEqual({
      layers: {}, proposals: [], scores: [], reports: [], audit: [],
    });
  });
  it("rejects invalid root payloads rather than hiding a failed read", () => {
    expect(() => normalizeWorkspace(null)).toThrow();
    expect(() => normalizeWorkspace("not JSON")).toThrow();
  });
});