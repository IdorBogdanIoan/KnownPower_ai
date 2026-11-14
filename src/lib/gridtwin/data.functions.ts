import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Workspace } from "./model";
export const readWorkspace = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(
  async ({ context }): Promise<string> => {
    const client = context.supabase;
    async function all(
      table: "layers" | "proposals" | "line_scores" | "field_reports" | "audit_log",
    ) {
      let rows: unknown[] = [];
      for (let start = 0; ; start += 1000) {
        const result = await client
          .from(table)
          .select("*")
          .range(start, start + 999);
        if (result.error) throw new Error(result.error.message);
        rows = rows.concat(result.data);
        if (result.data.length < 1000) break;
      }
      return rows;
    }
    const [layers, proposals, scores, reports, audit] = await Promise.all(
      ["layers", "proposals", "line_scores", "field_reports", "audit_log"].map((t) =>
        all(t as "layers" | "proposals" | "line_scores" | "field_reports" | "audit_log"),
      ),
    );
    return JSON.stringify({
      layers: Object.fromEntries(
        (layers as { name: string; geojson: Workspace["layers"][string] }[]).map((l) => [
          l.name,
          l.geojson,
        ]),
      ),
      proposals,
      scores,
      reports,
      audit,
    });
  },
);
