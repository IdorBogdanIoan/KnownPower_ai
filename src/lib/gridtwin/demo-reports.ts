import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { valueSchema, type Report } from "./model";
import { testWorkspace } from "./test-workspace";
import { readTestSession } from "./test-session";

const photoSchema = z.string().max(1400000).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/);
export const demoReportSchema = z.object({
  fictional: z.literal(true),
  actor: z.string().trim().min(2).max(100),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  pos_source: z.string().max(300).nullable(),
  fields: z.record(z.string().max(100), valueSchema).refine(fields => Object.keys(fields).length <= 30),
  pole_check: z.object({ valoare: z.boolean().nullable(), incredere: z.number().min(0).max(1), tip_vizibil: z.string().max(100).nullable().default(null) }).nullable(),
  photo_pole_url: photoSchema,
  photo_sheet_url: photoSchema,
});
export type DemoReportInput = z.infer<typeof demoReportSchema>;
export const demoDecisionSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["aprobat", "respins", "in_asteptare"]),
  actor: z.string().trim().min(2).max(100),
});
export function demoReportFromRow(row: Database["public"]["Tables"]["demo_reports"]["Row"]): Report {
  const payload = demoReportSchema.parse(row.payload);
  return { ...payload, id: row.id, created_at: row.created_at, status: row.status, decided_by: row.decided_by, decided_at: row.decided_at };
}
// Dedicated public client: never inherit the verified user's session or real-data credentials.
function publicDemoClient() {
  const url = import.meta.env['VITE_SUPABASE_URL'];
  const key = import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY'];
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
      headers.set("apikey", key);
      return fetch(input, { ...init, headers });
    } },
  });
}
export async function readDemoWorkspace() {
  const result = await publicDemoClient().from("demo_reports").select("*").order("created_at", { ascending: false }).limit(100);
  if (result.error) throw result.error;
  const reports = result.data.flatMap(row => {
    try { return [demoReportFromRow(row)]; } catch { return []; }
  });
  return { ...testWorkspace, reports };
}
export async function submitDemoReport(input: DemoReportInput) {
  const session = readTestSession();
  if (!session || !["field_team", "admin"].includes(session.role)) throw new Error("Acces la formular restricționat.");
  const payload = demoReportSchema.parse({ ...input, actor: session.name });
  const result = await publicDemoClient().from("demo_reports").insert({ payload: payload as unknown as Json }).select("id").single();
  if (result.error) throw result.error;
  return result.data.id;
}
export async function decideDemoReport(id: string, decision: "aprobat" | "respins" | "in_asteptare") {
  const session = readTestSession();
  if (!session || !["validation_team", "admin"].includes(session.role)) throw new Error("Acces la validare restricționat.");
  const input = demoDecisionSchema.parse({ id, decision, actor: session.name });
  const result = await publicDemoClient().from("demo_reports").update({
    status: input.decision,
    decided_by: decision === "in_asteptare" ? null : input.actor,
    decided_at: decision === "in_asteptare" ? null : new Date().toISOString(),
  }).eq("id", input.id).select("id").single();
  if (result.error) throw result.error;
}