import { describe, expect, it } from "vitest";
import proposals from "@/data/proposals.json";
import scores from "@/data/scores.json";
import { importTarget, parseImport, importError } from "./import";

describe("file import regression", () => {
  it("accepts the supplied proposals as GeoJSON as well as JSON", () => {
    const collection = { type: "FeatureCollection", features: proposals.map((p) => ({ type: "Feature", geometry: p.geometrie, properties: p })) };
    expect(parseImport("proposals", collection)).toEqual(parseImport("proposals", proposals));
  });
  it("accepts renamed files when an explicit destination is selected", () => {
    expect(importTarget("reteaua-mea.geojson", "gis")).toBe("gis");
    expect(importTarget("STREETS (1).GEOJSON", "")).toBe("streets");
    expect(() => importTarget("reteaua-mea.geojson", "")).toThrow();
  });
  it("validates scores before they are written", () => {
    expect(parseImport("scores", scores).kind).toBe("scores");
    expect(() => parseImport("scores", { ...scores, features: [{ ...scores.features[0], properties: { ...scores.features[0]?.properties, scor: 2 } }] })).toThrow();
  });
  it("preserves feature IDs and reports database messages", () => {
    const result = parseImport("gis", { type: "FeatureCollection", features: [{ type: "Feature", id: "pole-1", geometry: { type: "Point", coordinates: [28.6, 44.2] }, properties: null }] });
    if (result.kind !== "layer") throw new Error("Expected layer");
    expect(result.collection.features[0]?.id).toBe("pole-1");
    expect(importError({ message: "Upload refused" })).toBe("Upload refused");
  });
});