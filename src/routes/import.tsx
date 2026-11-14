import { createFileRoute } from "@tanstack/react-router";
import { workspaceQuery } from "@/lib/gridtwin/query";
import { ImportPage } from "@/components/gridtwin/ImportPage";
export const Route = createFileRoute("/import")({
  head: () => ({
    meta: [
      { title: "Import de date · GridTwin" },
      {
        name: "description",
        content: "Importă straturi GeoJSON, propuneri și scorurile agentului GridTwin.",
      },
      { property: "og:title", content: "Import de date · GridTwin" },
      {
        property: "og:description",
        content: "Încarcă datele GIS și rezultatele agentului de verificare.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(workspaceQuery),
  component: ImportPage,
});
