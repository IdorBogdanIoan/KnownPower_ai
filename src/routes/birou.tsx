import { createFileRoute, redirect } from "@tanstack/react-router";
import { workspaceQuery } from "@/lib/gridtwin/query";
import { Office } from "@/components/gridtwin/Office";
export const Route = createFileRoute("/birou")({
  head: () => ({
    meta: [
      { title: "Hartă · GridTwin" },
      {
        name: "description",
        content: "Harta rețelei JT, propuneri de corecție și aprobări auditate de operator.",
      },
      { property: "og:title", content: "Hartă · GridTwin" },
      {
        property: "og:description",
        content: "Verifică rețeaua și aprobă corecțiile din GIS și din teren.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: async ({ context }) => {
    const data = await context.queryClient.ensureQueryData(workspaceQuery);
    if (
      !data.proposals.length &&
      !data.scores.length &&
      !data.layers["osm_constanta"]?.features.length
    )
      throw redirect({ to: "/import" });
  },
  component: Office,
});
