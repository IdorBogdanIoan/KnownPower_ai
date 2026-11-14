import { expect, it } from "vitest";
import { demoDecisionSchema, demoReportFromRow, demoReportSchema } from "./demo-reports";
const input = {
  fictional: true, actor: "Echipa TEST", lat: 44.17, lon: 28.63, pos_source: "Marcat pe hartă",
  fields: { numar_stalp: { valoare: "TEST-001", incredere: 1, sursa: "manual" } },
  pole_check: null, photo_pole_url: "data:image/jpeg;base64,AAAA", photo_sheet_url: "data:image/jpeg;base64,AAAA",
};
it("accepts only explicitly fictional evidence for the public demo store", () => {
  expect(demoReportSchema.safeParse(input).success).toBe(true);
  expect(demoReportSchema.safeParse({ ...input, fictional: false }).success).toBe(false);
});
it("rejects external photo URLs and missing photos", () => {
  expect(demoReportSchema.safeParse({ ...input, photo_pole_url: "https://example.com/private.jpg" }).success).toBe(false);
  expect(demoReportSchema.safeParse({ ...input, photo_sheet_url: "" }).success).toBe(false);
});
it("preserves uploaded measurements and shared approval independently of login identity", () => {
  const report = demoReportFromRow({ id: "fd825d45-6965-43b8-801b-6e7869ce3bdd", created_at: "2026-11-14T17:00:00Z", payload: input, status: "aprobat", decided_by: "Validator TEST", decided_at: "2026-11-14T17:05:00Z" });
  expect(report.actor).toBe("Echipa TEST");
  expect(report.fields['numar_stalp']?.valoare).toBe("TEST-001");
  expect(report.status).toBe("aprobat");
  expect(report.decided_by).toBe("Validator TEST");
});
it("accepts the demo approval, rejection and undo states only", () => {
  for (const decision of ["aprobat", "respins", "in_asteptare"]) expect(demoDecisionSchema.safeParse({ id: "fd825d45-6965-43b8-801b-6e7869ce3bdd", actor: "Validator TEST", decision }).success).toBe(true);
  expect(demoDecisionSchema.safeParse({ id: "fd825d45-6965-43b8-801b-6e7869ce3bdd", actor: "Validator TEST", decision: "admin" }).success).toBe(false);
});