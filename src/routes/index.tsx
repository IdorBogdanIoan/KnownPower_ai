import { createFileRoute, redirect } from "@tanstack/react-router";
import { workspaceQuery } from "@/lib/gridtwin/query";
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GridTwin · Rețea de joasă tensiune" },
      {
        name: "description",
        content:
          "Consolă GIS pentru verificarea și aprobarea corecțiilor rețelei de joasă tensiune.",
      },
      { property: "og:title", content: "GridTwin · Rețea de joasă tensiune" },
      {
        property: "og:description",
        content: "Decizii umane, propuneri de agent și verificări din teren.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: async ({ context }) => {
    const data = await context.queryClient.ensureQueryData(workspaceQuery);
    throw redirect({
      to:
        data.proposals.length || data.scores.length || data.layers["osm_constanta"]?.features.length
          ? "/birou"
          : "/import",
    });
  },
});
