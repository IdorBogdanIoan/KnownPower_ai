import { createFileRoute } from "@tanstack/react-router";
import { workspaceQuery } from "@/lib/gridtwin/query";
import { Office } from "@/components/gridtwin/Office";
export const Route = createFileRoute("/_authenticated/birou")({
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
  loader: ({ context }) => context.queryClient.ensureQueryData(workspaceQuery),
  component: Office,
});
