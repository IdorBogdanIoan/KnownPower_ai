import { roleLabels, type AppRole } from "./access";
export const testSessionKey = "gridtwin-test-session";
export type TestSession = { name: string; role: AppRole };
export function parseTestSession(value: string | null): TestSession | null {
  try {
    const parsed: unknown = JSON.parse(value || "null");
    if (!parsed || typeof parsed !== "object" || !("name" in parsed) || !("role" in parsed)) return null;
    if (typeof parsed.name !== "string" || parsed.name.trim().length < 2 || parsed.name.length > 100 || typeof parsed.role !== "string" || !Object.hasOwn(roleLabels, parsed.role)) return null;
    return { name: parsed.name.trim(), role: parsed.role as AppRole };
  } catch { return null; }
}
export function readTestSession(): TestSession | null {
  return typeof window === "undefined" ? null : parseTestSession(sessionStorage.getItem(testSessionKey));
}
export function roleHome(role: AppRole) {
  return role === "field_team" ? "/teren" : role === "validation_team" ? "/validare" : "/birou";
}
export function canViewMap(roles: readonly AppRole[]) { return roles.includes("admin") || roles.includes("user"); }
export const testWriteNotice = "Salvarea datelor reale necesită un cont verificat.";