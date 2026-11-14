import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Workspace } from "./model";
export const readWorkspace = createServerFn({ method: "POST" }).handler(
  async (): Promise<string> => {
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    const url = process.env["SUPABASE_URL"];
    if (!key || !url) throw new Error("Cloud indisponibil");
    const client = createClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`)
            h.delete("Authorization");
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });
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
