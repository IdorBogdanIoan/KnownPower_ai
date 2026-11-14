import { describe, it, expect } from "vitest";
import { convertOsm, osmCoverage } from "./osm";
const raw = {
  elements: [
    {
      type: "way",
      id: 12,
      tags: { power: "minor_line", voltage: "400", name: "Test" },
      nodes: [1, 2],
      geometry: [
        { lat: 44.18, lon: 28.61 },
        { lat: 44.19, lon: 28.62 },
      ],
    },
  ],
  osm3s: { timestamp_osm_base: "2026-11-14T10:00:00Z" },
};
describe("Constanța OSM import", () => {
  it("keeps source, source snapshot and download date without inventing an import date", () => {
    const fc = convertOsm(raw, "manual", "2026-11-14T13:00:00Z");
    expect(fc.gridtwin.source).toBe("OpenStreetMap");
    expect(fc.gridtwin.snapshotAt).toBe("2026-11-14T10:00:00Z");
    expect(fc.gridtwin.fetchedAt).toBe("2026-11-14T13:00:00Z");
    expect(fc.gridtwin.importedAt).toBeNull();
    expect(fc.features[0]?.properties?.["voltage"]).toBe("400");
  });
  it("rejects empty or partial exports instead of replacing real data", () => {
    expect(() => convertOsm({ elements: [] }, "manual", "now")).toThrow();
    expect(() => convertOsm({ ...raw, remark: "timeout" }, "manual", "now")).toThrow("incomplet");
  });
  it("marks gaps as unknown, never as proof of no network or confirmed coverage", () => {
    const zones = osmCoverage(convertOsm(raw, "manual", "now"));
    expect(zones.features).toHaveLength(16);
    expect(zones.features.some((f) => f.properties?.["status"] === "no_lines")).toBe(true);
    expect(zones.features.some((f) => f.properties?.["status"] === "unverified")).toBe(true);
    expect(zones.features.some((f) => f.properties?.["status"] === "complete")).toBe(false);
  });
  it("does not import consumers or objects outside Constanța", () => {
    expect(() =>
      convertOsm(
        {
          elements: [{ type: "node", id: 1, lat: 44.18, lon: 28.61, tags: { power: "consumer" } }],
        },
        "manual",
        "now",
      ),
    ).toThrow();
    expect(() =>
      convertOsm(
        { elements: [{ type: "node", id: 1, lat: 45, lon: 26, tags: { power: "pole" } }] },
        "manual",
        "now",
      ),
    ).toThrow();
  });
});
