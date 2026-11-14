import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  CircleMarker,
  Tooltip,
  Marker,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as turf from "@turf/turf";
import { Layers, LocateFixed, Maximize, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusFilters } from "./StatusFilters";
import { initialStatuses, visibleOsm, visibleScore, visibleProposal, type StatusSelection } from "@/lib/gridtwin/map-status";
import { OpenFreeMapLayer } from "./OpenFreeMapLayer";
import { osmCoverage, osmMetadata } from "@/lib/gridtwin/osm";
import { approvedOsmInspection, osmTones, osmVerdicts } from "@/lib/gridtwin/osm-inspections";
import { clientVerification } from "@/lib/gridtwin/client-documents";
import {
  confidenceCells,
  conductor,
  effectiveScores,
  midpoint,
  tone,
  type Workspace,
  type Geometry,
  type Inspection,
  type Position,
} from "@/lib/gridtwin/model";
const switches = [
  ["osm", "Rețea OSM Constanța"],
  ["osmCoverage", "Acoperire OSM de verificat"],
  ["streets", "Străzi"],
  ["buildings", "Clădiri"],
  ["unknown", "Zone necunoscute"],
  ["gis", "Rețea GIS"],
  ["detections", "Detecții YOLO"],
  ["proposals", "Propuneri agent"],
  ["reports", "Rapoarte din teren"],
  ["confidence", "Încredere pe zonă"],
  ["conductors", "Secțiune conductor"],
];
function colors() {
  const css = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    ["safe", "warning", "danger", "primary", "field", "road", "building", "unknown", "pole", "underground", "clientFlag"].map(
      (k) => [k, css.getPropertyValue(`--${k}`).trim()],
    ),
  ) as Record<
    "safe" | "warning" | "danger" | "primary" | "field" | "road" | "building" | "unknown" | "pole" | "underground" | "clientFlag",
    string
  >;
}
function Frame({
  data,
  focus,
  onZoom,
}: {
  data: Workspace;
  focus?: Geometry | undefined;
  onZoom: (z: number) => void;
}) {
  const map = useMap();
  useEffect(() => {
    const svg = map.getPanes().overlayPane.querySelector("svg");
    if (!svg || svg.querySelector("#gridtwin-hatch")) return;
    const ns = "http://www.w3.org/2000/svg";
    const defs = document.createElementNS(ns, "defs");
    const pattern = document.createElementNS(ns, "pattern");
    pattern.setAttribute("id", "gridtwin-hatch");
    pattern.setAttribute("width", "7");
    pattern.setAttribute("height", "7");
    pattern.setAttribute("patternUnits", "userSpaceOnUse");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M-1,1 l2,-2 M0,7 l7,-7 M6,8 l2,-2");
    path.setAttribute("stroke", "var(--unknown)");
    path.setAttribute("stroke-width", "1.5");
    pattern.appendChild(path);
    defs.appendChild(pattern);
    svg.prepend(defs);
  }, [map]);
  useEffect(() => {
    const basis = data.layers["osm_constanta"]?.features.length
      ? data.layers["osm_constanta"]
      : data.layers["streets"]?.features.length
        ? data.layers["streets"]
        : turf.featureCollection(data.scores.map((s) => turf.feature(s.geometry)));
    if (!basis.features.length) return;
    const b = turf.bbox(basis);
    map.fitBounds(
      [
        [b[1], b[0]],
        [b[3], b[2]],
      ],
      { padding: [40, 40], maxZoom: 18 },
    );
  }, [map, data.layers["osm_constanta"], data.layers["streets"], data.scores.length]);
  useEffect(() => {
    if (!focus) return;
    const b = turf.bbox(turf.feature(focus));
    map.fitBounds(
      [
        [b[1], b[0]],
        [b[3], b[2]],
      ],
      { padding: [75, 75], maxZoom: 20 },
    );
  }, [map, focus]);
  useEffect(() => {
    onZoom(map.getZoom());
  }, [map, onZoom]);
  useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  return null;
}
function MiniFocus({ focus }: { focus: Geometry }) {
  const map = useMap();
  useEffect(() => {
    const b = turf.bbox(turf.feature(focus));
    map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [30, 30], maxZoom: 18 });
  }, [map, focus]);
  return null;
}
function Pick({
  position,
  onPosition,
}: {
  position?: Position;
  onPosition?: ((p: Position) => void) | undefined;
}) {
  useMapEvents({ click: (e) => onPosition?.([e.latlng.lng, e.latlng.lat]) });
  if (!position) return null;
  return (
    <Marker
      position={[position[1] ?? 0, position[0] ?? 0]}
      draggable
      icon={L.divIcon({
        className: "",
        html: '<div class="field-pin"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      })}
      eventHandlers={{
        dragend: (e) => {
          const p = e.target.getLatLng();
          onPosition?.([p["lng"], p["lat"]]);
        },
      }}
    >
      <Tooltip>Stâlp marcat în teren</Tooltip>
    </Marker>
  );
}
export default function MapView({
  data,
  selected,
  filter,
  onSelect,
  onInspect,
  onOsmSelect,
  focus,
  position,
  onPosition,
  mini = false,
  statuses,
}: {
  data: Workspace;
  selected?: string | undefined;
  filter?: string | undefined;
  onSelect?: (id: string) => void;
  onInspect?: (i: Inspection) => void;
  onOsmSelect?: (id: string) => void;
  focus?: Geometry | undefined;
  position?: Position;
  onPosition?: ((p: Position) => void) | undefined;
  mini?: boolean;
  statuses?: StatusSelection;
}) {
  const [localStatuses, setLocalStatuses] = useState<StatusSelection>(data.layers["osm_constanta"] ? initialStatuses : { ...initialStatuses, primary: false, safe: true });
  const activeStatuses = statuses ?? localStatuses;
  const [base, setBase] = useState("satellite");
  useEffect(() => {
    setBase(localStorage.getItem("gridtwin-basemap") || "satellite");
  }, []);
  const [menu, setMenu] = useState(false);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    streets: true,
    buildings: true,
    unknown: true,
    gis: true,
    detections: false,
    proposals: true,
    reports: true,
    confidence: false,
    conductors: false,
    osm: true,
    osmCoverage: true,
  });
  const [zoom, setZoom] = useState(18);
  const [palette, setPalette] = useState<
    Record<
      | "safe"
      | "warning"
      | "danger"
      | "primary"
      | "field"
      | "road"
      | "building"
      | "unknown"
      | "pole"
      | "underground" | "clientFlag",
      string
    >
  >({
    safe: "",
    warning: "",
    danger: "",
    primary: "",
    field: "",
    road: "",
    building: "",
    unknown: "",
    pole: "",
    underground: "", clientFlag: "",
  });
  const [reset, setReset] = useState(0);
  useEffect(() => {
    setPalette(colors());
    const observer = new MutationObserver(() => setPalette(colors()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  const scores = useMemo(() => effectiveScores(data), [data]);
  const osm = data.layers["osm_constanta"];
  const meta = osmMetadata(osm);
  const filteredOsm = useMemo(() => osm ? { ...osm, features: visibleOsm(osm.features, data.reports, activeStatuses) } : undefined, [osm, data.reports, activeStatuses]);
  const coverage = useMemo(() => (osm ? osmCoverage(osm) : undefined), [osm]);
  const cells = useMemo(
    () => (enabled["confidence"] ? confidenceCells(data) : []),
    [data, enabled["confidence"]],
  );
  const center =
    position ||
    midpoint(
      data.scores[0]?.geometry ||
        data.proposals[0]?.geometrie || { type: "Point", coordinates: [26.042, 44.534] },
    );
  function line(
    geometry: Geometry,
    key: string,
    color: string,
    width: number,
    dash?: string,
    click?: () => void,
    tip?: string,
  ) {
    return (
      <GeoJSON
        key={key}
        data={turf.feature(geometry)}
        style={{
          color,
          weight: width,
          ...(dash ? { dashArray: dash } : {}),
          fillColor:
            tip?.includes("nu se poate verifica") && key.startsWith("Z")
              ? "url(#gridtwin-hatch)"
              : color,
          fillOpacity: key.startsWith("Z") ? 0.35 : 0.18,
        }}
        eventHandlers={click ? { click: () => click() } : {}}
        pointToLayer={(_f, p) =>
          L.circleMarker(p, { radius: 6, color, weight: 2, fillOpacity: 0.15 })
        }
      >
        {tip && <Tooltip>{tip}</Tooltip>}
      </GeoJSON>
    );
  }
  return (
    <div className="map-wrap">
      <MapContainer
        key={reset}
        center={[center[1] ?? 0, center[0] ?? 0]}
        zoom={18}
        maxZoom={22}
        className="map-canvas"
        zoomControl={!mini}
      >
        {base === "map" && <OpenFreeMapLayer />}
        {base === "satellite" && (
          <TileLayer
            attribution="Esri"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxNativeZoom={19}
            maxZoom={22}
          />
        )}
        {!mini && <Frame data={data} focus={focus} onZoom={setZoom} />}
        {mini && focus && <MiniFocus focus={focus} />}
        {enabled["osmCoverage"] &&
          enabled["osm"] &&
          coverage?.features.map((f) => (
            <GeoJSON
              key={`${meta?.importedAt}-${f.properties?.["id"]}`}
              data={f}
              style={{
                color: palette["unknown"],
                weight: 1,
                dashArray: "4 6",
                fillOpacity: f.properties?.["status"] === "no_lines" ? 0.12 : 0.035,
              }}
            >
              <Tooltip>
                {f.properties?.["id"]} · {f.properties?.["reason"]}
              </Tooltip>
            </GeoJSON>
          ))}
        {enabled["osm"] && filteredOsm && (
          <GeoJSON
            key={`osm-${meta?.importedAt}-${JSON.stringify(activeStatuses)}-${data.reports.filter(r => r.osm_id).map(r => `${r.id}-${r.status}`).join(",")}`}
            data={filteredOsm}
            style={f => { const r = f && approvedOsmInspection(f, data.reports); return { color: palette[r?.osm_verdict ? osmTones[r.osm_verdict] : "primary"], weight: 3, fillOpacity: 0.12 }; }}
            pointToLayer={(f, p) => {
              const r = approvedOsmInspection(f, data.reports);
              return L.circleMarker(p, { radius: 5, color: palette[r?.osm_verdict ? osmTones[r.osm_verdict] : "primary"], fillOpacity: 0, weight: 3 });
            }
            }
            onEachFeature={(f, layer) => {
              const p = f.properties || {};
              const report = approvedOsmInspection(f, data.reports);
              const label = document.createElement("span");
              label.textContent = `${p["osm_id"]} · ${p["power"]} · ${report?.osm_verdict ? osmVerdicts[report.osm_verdict] : "Nevalidat"}${report ? ` · ${report.actor} · ${new Date(report.inspected_at || report.created_at).toLocaleString("ro-RO")}` : ""}`;
              layer.bindTooltip(label);
              layer.on("click", () => {
                onOsmSelect?.(String(p["osm_id"]));
                const el = document.createElement("div");
                const a = document.createElement("a");
                a.href = String(p["source_url"]);
                a.target = "_blank";
                a.rel = "noreferrer";
                a.textContent = `OpenStreetMap · ${p["osm_id"]}`;
                el.append(a);
                layer.bindPopup(el).openPopup();
              });
            }}
          />
        )}
        {enabled["confidence"] &&
          cells.filter(c => activeStatuses[c.unknown ? "primary" : tone(c.scor)]).map((c) =>
            line(
              c.geometry,
              `${c.id}-${c.scor}-${c.unknown}`,
              c.unknown ? palette["unknown"] : palette[tone(c.scor)],
              1,
              c.unknown ? "2 4" : undefined,
              () => onInspect?.(c),
              `${c.id} · ${Math.round(c.scor * 100)}%${c.unknown ? " · nu se poate verifica din imagine" : ""}`,
            ),
          )}
        {enabled["buildings"] && data.layers["buildings"] && (
          <GeoJSON
            data={data.layers["buildings"]}
            style={{ color: palette["building"], weight: 1, fillOpacity: 0.3 }}
          />
        )}
        {enabled["streets"] &&
          data.layers["streets"]?.features.map((f, i) => (
            <GeoJSON
              key={`street-${i}`}
              data={f}
              style={{ color: palette["road"], weight: 8, opacity: 0.8 }}
            >
              <Tooltip permanent direction="center" className="street-label">
                {f.properties?.["name"] || f.properties?.["nume"]}
              </Tooltip>
            </GeoJSON>
          ))}
        {enabled["unknown"] &&
          data.layers["unknown"]?.features.map((f, i) => (
            <GeoJSON
              key={`unknown-${i}`}
              data={f}
              style={{ color: palette["unknown"], fillOpacity: 0.18, weight: 1, dashArray: "3 5" }}
            >
              <Tooltip>
                {f.properties?.["motiv"] ||
                  f.properties?.["reason"] ||
                  "Nu se poate verifica din imagine"}
              </Tooltip>
            </GeoJSON>
          ))}
        {enabled["gis"] &&
          data.layers["gis"]?.features
            .filter((f) => f.properties?.["kind"] === "bransament")
            .map((f, i) =>
              line(
                f.geometry,
                `branch-${i}`,
                palette["pole"],
                1,
                undefined,
                undefined,
                String(f.properties?.["id"] || "Branșament"),
              ),
            )}
        {enabled["gis"] &&
          scores.filter(s => visibleScore(s.scor, activeStatuses)).map((s) =>
            line(
              s.geometry,
              `score-${s.id}-${s.scor}`,
              palette[tone(s.scor)],
              3.5,
              undefined,
              () => onInspect?.({ ...s, kind: "line" }),
              `${s.id} · ${Math.round(s.scor * 100)}% · ${s.motive.join(" · ")}`,
            ),
          )}
        {enabled["gis"] &&
          data.layers["gis"]?.features
            .filter((f) => ["stalp", "post_transformare"].includes(f.properties?.["kind"]))
            .map((f, i) => {
              if (f.geometry.type !== "Point") return null;
              const p = f.properties || {};
              return (
                <CircleMarker
                  key={`pole-${i}`}
                  center={[f.geometry.coordinates[1] ?? 0, f.geometry.coordinates[0] ?? 0]}
                  radius={p["kind"] === "post_transformare" ? 9 : 3.5}
                  pathOptions={{
                    color: p["kind"] === "post_transformare" ? palette["primary"] : palette["pole"],
                    fillColor:
                      p["kind"] === "post_transformare" ? palette["primary"] : palette["road"],
                    fillOpacity: 1,
                    weight: 1.8,
                  }}
                >
                  <Tooltip>
                    {[
                      p["id"],
                      p["material"],
                      p["type"] || p["tip"],
                      p["verified_year"] || p["an_verificare"],
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Tooltip>
                </CircleMarker>
              );
            })}
        {enabled["detections"] &&
          data.layers["detections"]?.features.map((f, i) =>
            line(
              f.geometry,
              `detection-${i}`,
              palette["pole"],
              1,
              "2 3",
              undefined,
              `YOLO · ${Math.round(Number(f.properties?.["conf"] || f.properties?.["confidence"] || 0) * 100)}%`,
            ),
          )}
        {enabled["proposals"] &&
          data.proposals
            .filter(
              (p) =>
                visibleProposal(p, activeStatuses) &&
                (p["tip"] !== "atribute_lipsa" ||
                  p["id"] === selected ||
                  filter === "atribute_lipsa"),
            )
            .map((p) => p.propus["flag"] === "echipa_teren" && p.status === "in_asteptare" ? (
              <CircleMarker key={`client-flag-${p.id}`} center={[midpoint(p.geometrie)[1] ?? 0,midpoint(p.geometrie)[0] ?? 0]} radius={7} pathOptions={{color:palette.clientFlag,fillColor:palette.clientFlag,fillOpacity:0.7,weight:2}} eventHandlers={{click:()=>onSelect?.(p.id)}}><Tooltip>{String(p.propus["adresa"] || p.obiect)} · Trimis la echipă</Tooltip></CircleMarker>
            ) :
              line(
                p["geometrie"],
                `proposal-${p["id"]}-${p["status"]}-${selected === p["id"]}`,
                p.status === "aprobat" && clientVerification(p)["rezultat"] === "subteran" ? palette.underground : p["status"] === "aprobat" ? palette["safe"] : palette["primary"],
                selected === p["id"] ? 6 : 3,
                p.status === "aprobat" && clientVerification(p)["rezultat"] === "subteran" ? "2 5" : p["status"] === "aprobat" ? undefined : "5 6",
                () => onSelect?.(p["id"]),
                `${p["id"]} · ${p["obiect"]} · ${Math.round(p["incredere"] * 100)}%`,
              ),
            )}
        {enabled["reports"] &&
          data.reports
            .filter((r) => !r.osm_id && r.status !== "respins")
            .map((r) => (
              <CircleMarker
                key={`${r.id}-${r.status}`}
                center={[r.lat, r.lon]}
                radius={8}
                pathOptions={{
                  color: r.status === "aprobat" ? palette["safe"] : palette["field"],
                  fillColor: r.status === "aprobat" ? palette["safe"] : palette["field"],
                  fillOpacity: 0.7,
                  weight: 2,
                  className: r.status === "in_asteptare" ? "report-pulse" : "",
                }}
              >
                <Tooltip>
                  {r.actor} · {r.status === "aprobat" ? "Verificat în teren" : "Raport din teren"}
                </Tooltip>
              </CircleMarker>
            ))}
        {enabled["conductors"] &&
          zoom >= 18 &&
          scores.filter(s => visibleScore(s.scor, activeStatuses)).map((s) => {
            const attrs = conductor(data, s.id);
            const section = attrs[1],
              material = attrs[2];
            if (!section || !material) return null;
            const pos = midpoint(s.geometry);
            const inferred = section.inferred || material.inferred;
            return (
              <CircleMarker
                key={`label-${s.id}`}
                center={[pos[1] ?? 0, pos[0] ?? 0]}
                radius={0}
                opacity={0}
              >
                <Tooltip
                  permanent
                  direction="center"
                  className={`line-label ${inferred && !section.approved ? "inferred-label" : ""}`}
                >
                  {section.value == null
                    ? "secțiune necunoscută"
                    : `${section.value} mm² ${material.value || ""}${inferred ? (section.approved ? " •" : ` ? ${Math.round(section.confidence * 100)}%`) : ""}`}
                </Tooltip>
              </CircleMarker>
            );
          })}
        {position && <Pick position={position} onPosition={onPosition} />}
      </MapContainer>
      {mini && <div className="mini-legend"><StatusFilters selected={localStatuses} onChange={setLocalStatuses} /><div className="legend-row"><i className="legend-dot" />Stâlp marcat în teren</div></div>}
      {!mini && (
        <>
          <div className="map-toolbar">
            {[
              ["map", "Hartă"],
              ["satellite", "Satelit"],
              ["none", "Fără fundal"],
            ].map(([key, label]) => (
              <Button
                variant="ghost"
                size="sm"
                key={key}
                className={base === key ? "active" : ""}
                onClick={() => {
                  if (key) {
                    setBase(key);
                    localStorage.setItem("gridtwin-basemap", key);
                  }
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="map-tools">
            <Button
              variant="ghost"
              size="icon"
              title="Straturi"
              aria-label="Straturi"
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X /> : <Layers />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Încadrează rețeaua"
              aria-label="Încadrează rețeaua"
              onClick={() => setReset(reset + 1)}
            >
              <LocateFixed />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Hartă pe tot ecranul"
              aria-label="Hartă pe tot ecranul"
              onClick={(e) => {
                const el = e.currentTarget.closest(".map-wrap");
                if (!document.fullscreenElement) void el?.requestFullscreen();
                else void document.exitFullscreen();
              }}
            >
              <Maximize />
            </Button>
          </div>
          {menu && (
            <div className="layer-menu">
              <h3>STRATURI VIZIBILE</h3>
              {switches.map(([key = "", label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={!!enabled[key]}
                    onChange={(e) => setEnabled({ ...enabled, [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>
          )}
          <div className="map-legend">
            <div className="legend-row"><i className="client-underground-line" />Branșament subteran confirmat</div>
            <div className="legend-row"><i className="client-flag-dot" />Echipă trimisă la client</div>
            {meta && <h3>Evaluare OSM aprobată</h3>}
            {meta && (
              <div className="legend-row">
                <span className="primary">━━</span> Rețea OSM nevalidată
              </div>
            )}
            <div className="legend-row">
              <i className="legend-line" />
              Sigur <span className="ml-auto text-muted-foreground">{meta ? "teren" : "≥ 70%"}</span>
            </div>
            <div className="legend-row">
              <i className="legend-line warning" />
              De verificat <span className="ml-auto text-muted-foreground">{meta ? "teren" : "40–69%"}</span>
            </div>
            <div className="legend-row">
              <i className="legend-line danger" />
              Nesigur <span className="ml-auto text-muted-foreground">{meta ? "teren" : "< 40%"}</span>
            </div>
            <div className="legend-row">
              <i className="legend-line proposal" />
              Nevalidat
            </div>
            <div className="extended-legend">
              {enabled["confidence"] && (
                <div className="legend-row">Zone: verde / galben / roșu</div>
              )}
              {enabled["conductors"] && (
                <div className="legend-row">
                  70 mm² Al · <em>70 mm² Al ? 85%</em>
                </div>
              )}
            </div>
          </div>
          {meta ? (
            <div className="map-note">
              OpenStreetMap · {osm?.features.length} obiecte
              <br />
              Import:{" "}
              {meta.importedAt ? new Date(meta.importedAt).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" }) : "neconfirmat"}
              <br />
              Zone punctate: acoperire de verificat, nu absența rețelei
            </div>
          ) : (
            !data.layers["gis"] && (
              <div className="map-note">
                GIS original neîncărcat · afișare după scorurile agentului
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
