import { createFileRoute } from "@tanstack/react-router";
import { workspaceQuery } from "@/lib/gridtwin/query";
import { FieldPage } from "@/components/gridtwin/FieldPage";
import { AccessRequired } from "@/components/gridtwin/Account";
export const Route = createFileRoute("/_authenticated/teren")({
  validateSearch: (search: Record<string, unknown>): { osm?: string } => typeof search["osm"] === "string" ? { osm: search["osm"] } : {},
  head: () => ({
    meta: [
      { title: "Raport din teren · KnownPower" },
      {
        name: "description",
        content: "Trimite fotografii, măsurători și poziția stâlpului către operatorul KnownPower.",
      },
      { property: "og:title", content: "Raport din teren · KnownPower" },
      {
        property: "og:description",
        content: "Confirmă rețeaua de joasă tensiune cu fotografii și măsurători din teren.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(workspaceQuery),
  component: () => <AccessRequired kind="submit"><FieldPage /></AccessRequired>,
});
