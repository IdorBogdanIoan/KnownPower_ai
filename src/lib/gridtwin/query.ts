import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { readWorkspace } from "./data.functions";
import { toast } from "sonner";
import { normalizeWorkspace } from "./workspace";
import { readTestSession, testWriteNotice } from "./test-session";
import { testWorkspace } from "./test-workspace";
export const workspaceQuery = queryOptions({
  queryKey: ["gridtwin"],
  queryFn: async () => readTestSession() ? testWorkspace : normalizeWorkspace(await readWorkspace()),
  staleTime: 15000,
});
export function useWorkspace() {
  const query = useSuspenseQuery(workspaceQuery);
  const client = useQueryClient();
  useEffect(() => {
    if (readTestSession()) return;
    const channel = supabase.channel(`gridtwin-${crypto.randomUUID()}`);
    for (const table of ["layers", "proposals", "line_scores", "field_reports", "audit_log"])
      channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
        if (table === "field_reports" && payload.eventType === "INSERT")
          toast("Raport nou din teren");
        void client.invalidateQueries({ queryKey: ["gridtwin"] });
      });
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [client]);
  return normalizeWorkspace(query.data);
}
export async function audit(actor: string, text: string) {
  if (readTestSession()) throw new Error(testWriteNotice);
  const { error } = await supabase.from("audit_log").insert({ actor, text });
  if (error) throw error;
}
