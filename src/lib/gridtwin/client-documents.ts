import { z } from "zod";
import { distanceM, midpoint, type Proposal, type FeatureCollection, type Geometry } from "./model";
export function normalizeClientText(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(str|strada|nr|numar|numarul)\b/g, " ").replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}
export function documentDate(text: string): string | null {
  const match = text.match(/\b(?:\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})\b/);
  if (!match) return null;
  const iso = match[0].includes(".") ? match[0].split(".").reverse().join("-") : match[0];
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === iso ? iso : null;
}
export type ClientDocument = { id: string; kind: string; pod: string | null; data: string | null; text: string; text_norm: string; imported_at?: string };
const contractsSchema = z.array(z.object({ pod: z.string().min(1).max(200), adresa: z.string().min(1), data_racordare: z.string().nullable().optional(), putere_aprobata_kw: z.union([z.number(),z.string()]).nullable().optional() }));
export function parseClientDocuments(name: string, content: string): ClientDocument[] {
  if (content.length > 2000000) throw new Error("Fișier prea mare (maximum 2 MB).");
  if (/\.txt$/i.test(name)) {
    if (!content.trim()) throw new Error("Documentul este gol.");
    const id = name.replace(/\.txt$/i, "");
    return [{ id, kind: id.split("-")[0]?.toLowerCase() || "raport", pod: null, data: documentDate(content), text: content, text_norm: normalizeClientText(content) }];
  }
  if (name.toLowerCase() !== "contracts.json") throw new Error("Alege fișiere TXT sau contracts.json.");
  return contractsSchema.parse(JSON.parse(content.replace(/^\uFEFF/, ""))).map(c => {
    const text = `${c.adresa}\nPOD: ${c.pod}\nData racordării: ${c.data_racordare || "neprecizată"}\nPutere aprobată: ${c.putere_aprobata_kw ?? "neprecizată"} kW`;
    return { id: c.pod, kind: "contract", pod: c.pod, data: documentDate(text), text, text_norm: normalizeClientText(text) };
  });
}
export function addressMatches(address: string, text: string) { const normalized = normalizeClientText(address); return !!normalized && (` ${normalizeClientText(text)} `).includes(` ${normalized} `); }
export const connectionSchema = z.object({ tip_racord: z.enum(["subteran","aerian","necunoscut"]), document: z.string(), dovada: z.string().max(2000), incredere: z.number().min(0).max(1) }).strict();
export type ConnectionResult = z.infer<typeof connectionSchema>;
export function classifyDocuments(documents: ClientDocument[]): ConnectionResult {
  let result: ConnectionResult = { tip_racord: "necunoscut", document: documents.at(-1)?.id || "", dovada: "Documentele nu precizează clar tipul racordului.", incredere: 0 };
  for (const doc of documents) {
    for (const sentence of doc.text.split(/(?<=[.!?;])\s+|\n+/)) {
      const t = normalizeClientText(sentence);
      const underground = /\b(subteran[a-z]*|les|acyaby|ingropat[a-z]*)\b|cablu pozat in (pamant|sant)|coborare pe stalp/.test(t);
      const aerial = /\b(aerian[a-z]*|tyir|torsadat[a-z]*|lea)\b|pe fatada/.test(t);
      const replacement = /inlocuit.*aerian.*subteran/.test(t);
      const negUnderground = /(?:nu exista|nu este|nu e|fara|respins[a-z]*|neaprobat[a-z]*|nu s a aprobat).{0,65}(?:subteran|les|acyaby)|(?:subteran[a-z]*|les|acyaby).{0,45}(?:respins[a-z]*|neaprobat[a-z]*|nu exista|nu este aprobat)/.test(t);
      const tentative = /\b(propune|propus|varianta|proiectat|posibil|intentioneaza)\b/.test(t) && !/\b(executat|realizat|inlocuit|receptionat|racordat)\b/.test(t);
      if (replacement && !negUnderground) result = { tip_racord: "subteran", document: doc.id, dovada: sentence.trim(), incredere: 0.85 };
      else if (negUnderground) result = { tip_racord: aerial ? "aerian" : "necunoscut", document: doc.id, dovada: sentence.trim(), incredere: aerial ? 0.8 : 0 };
      else if (!tentative && underground && !aerial) result = { tip_racord: "subteran", document: doc.id, dovada: sentence.trim(), incredere: 0.8 };
      else if (!tentative && aerial && !underground && !/nu.{0,20}aerian|aerian.{0,20}respins/.test(t)) result = { tip_racord: "aerian", document: doc.id, dovada: sentence.trim(), incredere: 0.8 };
    }
  }
  return result;
}
export const isClient = (p: Proposal) => p.tip === "verificare_teren" || p.tip === "bransament_lipsa";
export function clientLine(p: Proposal, gis?: FeatureCollection): Geometry | null {
  const poles = gis?.features.filter(f => f.geometry.type === "Point" && f.properties?.["kind"] === "stalp") || [];
  const building = p.propus["building"];
  const feature = typeof building === "string" ? gis?.features.find(f => f.properties?.["id"] === building) : undefined;
  const geometry = feature?.geometry || (p.geometrie.type === "Point" || p.geometrie.type === "Polygon" || p.geometrie.type === "MultiPolygon" ? p.geometrie : null);
  if (!geometry || !poles.length) return null;
  const start = midpoint(geometry);
  const preferred = poles.find(f => f.properties?.["id"] === p.propus["stalp_probabil"]);
  const pole = preferred || [...poles].sort((a,b) => distanceM(start,midpoint(a.geometry))-distanceM(start,midpoint(b.geometry)))[0];
  if (!pole) return null;
  return { type: "LineString", coordinates: [start,midpoint(pole.geometry)] };
}
export function clientVerification(p: Proposal): Record<string, unknown> { const v = p.propus["verificare"]; return v && typeof v === "object" ? v as Record<string,unknown> : {}; }
export function clientState(p: Proposal) {
  const v = clientVerification(p); const result = v["rezultat"];
  if (p.status === "aprobat" && result === "subteran") return `Conectat subteran · ${v["document"] || "document"}${v["data"] ? ` (${String(v["data"]).slice(0,4)})` : ""}`;
  if (result === "fara_document") return "Fără contract · trimis la echipă";
  if (result === "aerian") return "Trimis la echipă · contractul spune aerian";
  if (result) return "Trimis la echipă · racord neconfirmat";
  return "Neverificat";
}