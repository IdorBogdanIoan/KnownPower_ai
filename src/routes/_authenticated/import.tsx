import { createFileRoute } from "@tanstack/react-router";
import { workspaceQuery } from "@/lib/gridtwin/query";
import { ImportPage } from "@/components/gridtwin/ImportPage";
import { AccessRequired } from "@/components/gridtwin/Account";
export const Route = createFileRoute("/_authenticated/import")({
  head: () => ({
    meta: [
      { title: "Import de date · KnownPower" },
      {
        name: "description",
        content: "Importă straturi GeoJSON, propuneri și scorurile agentului KnownPower.",
      },
      { property: "og:title", content: "Import de date · KnownPower" },
      {
        property: "og:description",
        content: "Încarcă datele GIS și rezultatele agentului de verificare.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(workspaceQuery),
  component: () => <AccessRequired kind="admin"><ImportPage /></AccessRequired>,
});
