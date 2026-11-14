import { expect, it } from "vitest";
import { canViewMap, parseTestSession, roleHome } from "./test-session";
it("rejects malformed names and roles", () => {
  expect(parseTestSession('{"name":"A","role":"admin"}')).toBeNull();
  expect(parseTestSession('{"name":"Tester","role":"superadmin"}')).toBeNull();
  expect(parseTestSession('{"name":"Tester","role":"toString"}')).toBeNull();
});
it("user has map only", () => { expect(roleHome("user")).toBe("/birou"); expect(canViewMap(["user"])).toBe(true); });
it("field team starts at report upload without map page", () => { expect(roleHome("field_team")).toBe("/teren"); expect(canViewMap(["field_team"])).toBe(false); });
it("validation team starts at reports without map page", () => { expect(roleHome("validation_team")).toBe("/validare"); expect(canViewMap(["validation_team"])).toBe(false); });
it("admin has map access", () => { expect(roleHome("admin")).toBe("/birou"); expect(canViewMap(["admin"])).toBe(true); });