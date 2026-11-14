import { describe, expect, it } from "vitest";
import { permissions } from "./access";
describe("account access", () => {
  it("Field team submits but cannot validate or configure", () => { expect(permissions(["field_team"])).toEqual({ admin: false, submit: true, validate: false, view: true }); });
  it("Validation team validates but cannot submit or configure", () => { expect(permissions(["validation_team"])).toEqual({ admin: false, submit: false, validate: true, view: true }); });
  it("admin has full access", () => { expect(permissions(["admin"])).toEqual({ admin: true, submit: true, validate: true, view: true }); });
  it("Utilizator is read-only", () => { expect(permissions(["user"])).toEqual({ admin: false, submit: false, validate: false, view: true }); });
});