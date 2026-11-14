import { createServerFn } from "@tanstack/react-start";
import { convertOsm, osmQuery } from "./osm";

export const fetchConstantaOsm = createServerFn({ method: "POST" }).handler(async () => {
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
  ];
  const failures: string[] = [];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint}?data=${encodeURIComponent(osmQuery)}`, {
        headers: {
          "User-Agent": "GridTwin/1.0 (Constanta public power infrastructure import)",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(18000),
      });
      if (!response.ok) {
        failures.push(`HTTP ${response.status}`);
        continue;
      }
      const text = await response.text();
      if (text.length > 12000000) throw new Error("Export prea mare");
      return JSON.stringify(convertOsm(JSON.parse(text), endpoint, new Date().toISOString()));
    } catch (error) {
      failures.push(
        error instanceof Error && error.name === "TimeoutError"
          ? "timp de răspuns depășit"
          : "export indisponibil sau incomplet",
      );
    }
  }
  throw new Error(
    `OpenStreetMap nu a putut fi citit (${failures.join("; ")}). Importul anterior este păstrat. Poți încărca un export JSON din Overpass Turbo.`,
  );
});
