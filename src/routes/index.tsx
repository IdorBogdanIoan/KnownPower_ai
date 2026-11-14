import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "KnownPower · Rețea de joasă tensiune" },
      {
        name: "description",
        content:
          "Consolă GIS pentru verificarea și aprobarea corecțiilor rețelei de joasă tensiune.",
      },
      { property: "og:title", content: "KnownPower · Rețea de joasă tensiune" },
      {
        property: "og:description",
        content: "Decizii umane, propuneri de agent și verificări din teren.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: () => { throw redirect({ to: "/birou" }); },
});
