import { describe, it, expect } from "vitest";
import {
  zoneScore,
  tone,
  endpointVerified,
  distanceM,
  sortedProposals,
  proposalSchema,
  snapToLine,
  type Report,
  type Score,
} from "./model";
import proposals from "@/data/proposals.json";
import scores from "@/data/scores.json";
describe("GridTwin confidence rules", () => {
  it("uses green starting at 0.7", () => {
    expect(tone(0.7)).toBe("safe");
    expect(tone(0.699)).toBe("warning");
  });
  it("uses yellow starting at 0.4", () => {
    expect(tone(0.4)).toBe("warning");
    expect(tone(0.399)).toBe("danger");
  });
  it("subtracts 0.1 for each pending proposal", () =>
    expect(zoneScore([0.8], 2, false)).toBeCloseTo(0.6));
  it("caps pending deduction at 0.3", () => expect(zoneScore([0.8], 5, false)).toBeCloseTo(0.5));
  it("approved field report sets confidence to 1", () => expect(zoneScore([0.1], 5, true)).toBe(1));
  it("does not upgrade a pending field report", () => expect(zoneScore([0.1], 0, false)).toBe(0.1));
  it("orders pending first and gaps before poles", () => {
    const parsed = proposals.map((p) => proposalSchema.parse(p));
    const sorted = sortedProposals(parsed);
    expect(sorted[0]?.tip).toBe("gol_retea");
    const changed = parsed.map((p) =>
      p.id === sorted[0]?.id ? { ...p, status: "aprobat" as const } : p,
    );
    expect(sortedProposals(changed).at(-1)?.status).toBe("aprobat");
  });
  it("a report must be approved and within 25 meters of an endpoint", () => {
    const geometry = {
      type: "LineString" as const,
      coordinates: [
        [26, 44],
        [26.001, 44],
      ],
    };
    const base = {
      id: "r",
      actor: "test",
      status: "in_asteptare",
      lat: 44,
      lon: 26,
      created_at: "2026-11-14",
      fields: {},
      pole_check: null,
      photo_pole_url: null,
      photo_sheet_url: null,
      pos_source: null,
      decided_by: null,
      decided_at: null,
    } satisfies Report;
    expect(endpointVerified(geometry, [base])).toBeUndefined();
    expect(endpointVerified(geometry, [{ ...base, status: "aprobat" }])?.id).toBe("r");
    expect(
      endpointVerified(geometry, [{ ...base, status: "aprobat", lat: 44.001 }]),
    ).toBeUndefined();
  });
  it("snap places point on closest line", () => {
    const input: Score[] = [
      {
        id: "T1",
        geometry: {
          type: "LineString",
          coordinates: [
            [26, 44],
            [26.001, 44],
          ],
        },
        scor: 0.5,
        culoare: "galben",
        motive: [],
      },
    ];
    const result = snapToLine([26.0005, 44.0001], input);
    expect(result?.id).toBe("T1");
    expect(result?.position[1]).toBeCloseTo(44, 5);
    expect(result?.distance).toBeGreaterThan(10);
  });
  it("validates supplied proposals without inventing records", () => {
    expect(proposals.map((p) => proposalSchema.parse(p))).toHaveLength(77);
    expect(scores.features).toHaveLength(42);
  });
});
