import { beforeEach, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  role: "admin",
  fail: "",
  rows: {} as Record<string, unknown[]>,
  calls: [] as { table: string; start: number; end: number }[],
}));
vi.mock("./test-session", () => ({ readTestSession: () => ({ name: "Demo", role: state.role }) }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: (table: string) => ({
    select: () => ({ order: () => ({
      limit: async () => ({ data: state.rows[table] || [], error: null }),
      range: async (start: number, end: number) => {
        state.calls.push({ table, start, end });
        return { data: (state.rows[table] || []).slice(start, end + 1), error: state.fail === table ? new Error("Unavailable") : null };
      },
    }) }),
  }) }),
}));

import { readDemoWorkspace } from "./demo-reports";
import { testWorkspace } from "./test-workspace";

beforeEach(() => {
  state.role = "admin";
  state.fail = "";
  state.calls = [];
  state.rows = {
    demo_reports: [],
    layers: [{ name: "gis", geojson: { type: "FeatureCollection", features: [] } }],
    proposals: [{ id: "PTAB-7812-proposal" }],
    line_scores: [{ id: "PTAB-7812-line", scor: 0.2 }],
  };
});

it("demo admin uses stored layers, proposals and line scores with an empty audit", async () => {
  const workspace = await readDemoWorkspace();
  expect(workspace.layers).toEqual({ gis: { type: "FeatureCollection", features: [] } });
  expect(workspace.proposals).toEqual(state.rows["proposals"]);
  expect(workspace.scores).toEqual(state.rows["line_scores"]);
  expect(workspace.audit).toEqual([]);
});

it.each(["user", "field_team", "validation_team"])("demo %s retains bundled data without reading network tables", async role => {
  state.role = role;
  const workspace = await readDemoWorkspace();
  expect(workspace).toEqual({ ...testWorkspace, reports: [] });
  expect(state.calls).toEqual([]);
});

it.each(["layers", "proposals", "line_scores"])("falls back to bundled data if %s fails while retaining shared reports", async table => {
  state.fail = table;
  state.rows["demo_reports"] = [{
    id: "fd825d45-6965-43b8-801b-6e7869ce3bdd", created_at: "2026-11-14T17:00:00Z", status: "in_asteptare", decided_by: null, decided_at: null,
    payload: { fictional: true, actor: "Demo inspector", lat: 44.17, lon: 28.63, pos_source: null, fields: {}, pole_check: null, photo_pole_url: "data:image/jpeg;base64,AAAA", photo_sheet_url: "data:image/jpeg;base64,AAAA" },
  }];
  const workspace = await readDemoWorkspace();
  expect(workspace.layers).toEqual(testWorkspace.layers);
  expect(workspace.proposals).toEqual(testWorkspace.proposals);
  expect(workspace.scores).toEqual(testWorkspace.scores);
  expect(workspace.reports.map(report => report.id)).toEqual(["fd825d45-6965-43b8-801b-6e7869ce3bdd"]);
});

it("paginates all three network tables in chunks of 1000", async () => {
  for (const table of ["layers", "proposals", "line_scores"]) {
    state.rows[table] = Array.from({ length: 1001 }, (_, i) => ({ id: String(i), name: String(i), geojson: { type: "FeatureCollection", features: [] } }));
  }
  const workspace = await readDemoWorkspace();
  expect(Object.keys(workspace.layers)).toHaveLength(1001);
  expect(workspace.proposals).toHaveLength(1001);
  expect(workspace.scores).toHaveLength(1001);
  for (const table of ["layers", "proposals", "line_scores"]) {
    expect(state.calls.filter(call => call.table === table)).toEqual([
      { table, start: 0, end: 999 }, { table, start: 1000, end: 1999 },
    ]);
  }
});

it("refetches the shared query key after role-switch cache clearing", async () => {
  const client = new QueryClient();
  const query = { queryKey: ["gridtwin"], queryFn: readDemoWorkspace, staleTime: 15000 };
  expect((await client.fetchQuery(query)).proposals).toEqual(state.rows["proposals"]);
  state.role = "user";
  client.clear();
  expect((await client.fetchQuery(query)).proposals).toEqual(testWorkspace.proposals);
  state.role = "admin";
  client.clear();
  expect((await client.fetchQuery(query)).proposals).toEqual(state.rows["proposals"]);
  client.clear();
});