import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ClientOnly, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  X,
  MapPin,
  ShieldCheck,
  Search,
  ArrowUpRight,
  Link2,
  Camera,
  History,
  ListFilter,
  Undo2,
  Activity,
  ChevronDown,
  Upload,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace, audit } from "@/lib/gridtwin/query";
import {
  labels,
  types,
  sortedProposals,
  effectiveScores,
  tone,
  nearby,
  midpoint,
  conductor,
  inferred,
  fieldLabels,
  type Proposal,
  type Geometry,
  type Inspection,
  type Report,
} from "@/lib/gridtwin/model";
import { useOperator } from "./Shell";
import { useAccount } from "./Account";
import { testWriteNotice } from "@/lib/gridtwin/test-session";
import { ClientCard } from "./ClientCard";
import { ClientBatch, useClientVerification } from "./ClientVerification";
import { isClient } from "@/lib/gridtwin/client-documents";
import { osmMetadata } from "@/lib/gridtwin/osm";
import { approvedOsmInspection, osmVerdicts, osmTones } from "@/lib/gridtwin/osm-inspections";
import { OsmOfficeList } from "./OsmOfficeList";
import { StatusFilters } from "./StatusFilters";
import { initialStatuses, unsafeProposals, type StatusSelection } from "@/lib/gridtwin/map-status";
const MapView = lazy(() => import("./MapView"));
const tipIcons: Record<string, typeof Activity> = {
  gol_retea: Link2,
  stalp_lipsa: MapPin,
  corectie_pozitie: MapPin,
  tronson_lipsa: Activity,
  atribute_lipsa: ListFilter,
};
const humanKey: Record<string, string> = {
  conductor_type: "Tip conductor",
  section_mm2: "Secțiune (mm²)",
  material: "Material",
  pozitie_noua: "Poziție nouă",
  stalpi_neconectati: "Stâlpi neconectați",
  actiune: "Acțiune",
  tronsoane_afectate: "Tronsoane afectate",
  bransamente_afectate: "Branșamente afectate",
};
function display(v: unknown): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object")
    return Object.entries(v)
      .map(([k, x]) => `${humanKey[k] || k.replaceAll("_", " ")}: ${display(x)}`)
      .join(" · ");
  return String(v);
}
function Photo({ path }: { path: string | null }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!path) return;
    let alive = true;
    supabase.storage
      .from("field-photos")
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (alive) setUrl(data?.signedUrl || "");
      });
    return () => {
      alive = false;
    };
  }, [path]);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="Fotografie raport din teren" />
    </a>
  ) : (
    <div className="bg-muted h-24" />
  );
}
export function Office() {
  const clientVerification = useClientVerification();
  const data = useWorkspace();
  const osmMeta = osmMetadata(data.layers["osm_constanta"]);
  const [statuses, setStatuses] = useState<StatusSelection>(initialStatuses);
  const actor = useOperator();
  const access = useAccount();
  const settings = useQuery({ queryKey: ["app-settings"], enabled: !access.test, queryFn: async () => { const r = await supabase.from("app_settings").select("*"); if (r.error) throw r.error; return Object.fromEntries(r.data.map(x => [x.key,x.value])); } });
  const client = useQueryClient();
  const [tab, setTab] = useState(data.layers["osm_constanta"] ? "osm" : "proposals");
  const [osmSelected, setOsmSelected] = useState<string>();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string>();
  const [focus, setFocus] = useState<Geometry>();
  const [inspection, setInspection] = useState<Inspection>();
  const [busy, setBusy] = useState<string>();
  const [statusFilter, setStatusFilter] = useState("in_asteptare");
  const reportIds = useRef<string[] | null>(null);
  useEffect(() => {
    if (reportIds.current) {
      const r = data.reports.find((r) => !reportIds.current?.includes(r.id));
      if (r) {
        setFocus({ type: "Point", coordinates: [r.lon, r.lat] });
        setTab("field");
      }
    }
    reportIds.current = data.reports.map((r) => r.id);
  }, [data.reports]);
  const scores = effectiveScores(data);
  const osmFeatures = data.layers["osm_constanta"]?.features || [];
  const osmApproved = osmFeatures.map(f => approvedOsmInspection(f, data.reports));
  const eligibleProposals = useMemo(() => unsafeProposals(data), [data]);
  const proposals = useMemo(
    () =>
      sortedProposals(eligibleProposals).filter(
        (p) =>
          (filter === "all" || p["tip"] === filter) &&
          p["status"] === statusFilter &&
          `${p["id"]} ${p["obiect"]} ${p["motiv"]}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [eligibleProposals, filter, search, statusFilter],
  );
  function select(id: string) {
    const p = eligibleProposals.find((p) => p["id"] === id);
    if (!p) return;
    setSelected(id);
    setFocus(p["geometrie"]);
    setTab("proposals");
    setFilter("all");
    setStatusFilter(p.status);
    setInspection(undefined);
    setTimeout(
      () =>
        document
          .getElementById(`proposal-${id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
      100,
    );
  }
  async function decide(
    id: string,
    kind: "proposal" | "field",
    decision: "aprobat" | "respins" | "in_asteptare",
  ) {
    if (access.test) { toast.info(testWriteNotice); return; }
    if (!actor || !access.validate) {
      toast.error("Completează numele operatorului.");
      return;
    }
    setBusy(id);
    try {
      const { error } = await supabase.rpc("decide_grid_item", {
        item_id: id,
        item_kind: kind,
        decision,
        operator_name: actor,
      });
      if (error) throw error;
      await client.invalidateQueries({ queryKey: ["gridtwin"] }, { cancelRefetch: false });
      toast.success(
        decision === "aprobat"
          ? "Aprobat și inclus în model"
          : decision === "respins"
            ? "Respins"
            : "Decizie anulată",
      );
    } catch {
      toast.error("Decizia nu a fost salvată. Reîncearcă.");
    } finally {
      setBusy(undefined);
    }
  }
  const nearbyP = inspection
    ? eligibleProposals.filter(
        (p) =>
          p["status"] === "in_asteptare" &&
          nearby(p["geometrie"], midpoint(inspection.geometry), 50),
      )
    : [];
  const nearbyR = inspection
    ? data.reports.filter((r) => nearby(inspection.geometry, [r.lon, r.lat], 50))
    : [];
  const currentInspection =
    inspection?.kind === "line"
      ? { ...inspection, ...scores.find((s) => s.id === inspection.id) }
      : inspection;
  return (
    <>
      <div className="workspace-bar">
        <div>
          <div className="workspace-title">
            {settings.data?.["workspace_title"] || (data.layers["osm_constanta"]
              ? "Rețea cartografiată · Constanța"
              : "Rețea de joasă tensiune")}{" "}
          </div>
          <div className="workspace-subtitle">
            {data.layers["osm_constanta"]
              ? "OSM · evaluări din teren aprobate · simulările rămân separate"
              : "GIS companie / verificare agent / confirmare din teren"}
          </div>
          {osmMeta && (
            <div className="workspace-subtitle">
              <a
                className="text-primary underline"
                href={osmMeta.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                OpenStreetMap
              </a>{" "}
              · Import:{" "}
              {osmMeta.importedAt
                ? new Date(osmMeta.importedAt).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" })
                : "neconfirmat"}{" "}
              · Acoperire incompletă
            </div>
          )}
          {settings.data?.["workspace_notice"] && <div className="workspace-subtitle">{settings.data["workspace_notice"]}</div>}
        </div>
        <div className="workspace-actions">
          {access.admin && <Button variant="outline" size="sm" asChild>
            <Link to="/import">
              <Upload />
              Importă date
            </Link>
          </Button>}
          {access.submit && <Button variant="field" size="sm" asChild>
            <Link to="/teren">
              <Camera />
              Raport din teren
            </Link>
          </Button>}
        </div>
      </div>
      <div className="office-body">
        <ClientOnly fallback={<div className="map-loading">Se încarcă harta…</div>}>
          <Suspense fallback={<div className="map-loading">Se încarcă harta…</div>}>
            <MapView
              data={data}
              statuses={statuses}
              selected={selected}
              filter={filter}
              onSelect={select}
              onInspect={(i) => {
                setInspection(i);
                setSelected(undefined);
              }}
              focus={focus}
              onOsmSelect={id => { setOsmSelected(id); setTab("osm"); setInspection(undefined); setSelected(undefined); }}
            />
          </Suspense>
        </ClientOnly>
        <aside className="operator-panel">
          <StatusFilters selected={statuses} onChange={setStatuses} />
          <div className="stats">
            {[
              ["safe", "Sigur", osmMeta ? osmApproved.filter(r => r?.osm_verdict === "sigur").length : scores.filter((s) => s.scor >= 0.7).length],
              [
                "warning",
                "Partial Sigur",
                osmMeta ? osmApproved.filter(r => r?.osm_verdict === "de_verificat").length : scores.filter((s) => s.scor >= 0.4 && s.scor < 0.7).length,
              ],
              ["danger", "Nesigur", osmMeta ? osmApproved.filter(r => r?.osm_verdict === "nesigur").length : scores.filter((s) => s.scor < 0.4).length],
            ].map(([color, label, value]) => (
              <div className="stat" key={label}>
                <div className={`stat-number ${color}`}>{value}</div>
                <div className="stat-label">
                  {label}
                </div>
              </div>
            ))}
          </div>
          <div className="panel-tabs">
            {osmMeta && <Button variant="ghost" className={tab === "osm" ? "active" : ""} onClick={() => { setTab("osm"); setOsmSelected(undefined); }}><ShieldCheck />OSM <span className="tab-count">{osmFeatures.length}</span></Button>}
            <Button
              variant="ghost"
              className={tab === "proposals" ? "active" : ""}
              onClick={() => setTab("proposals")}
            >
              <ListFilter />
              Propuneri <span className="tab-count">{eligibleProposals.length}</span>
            </Button>
            <Button
              variant="ghost"
              className={tab === "field" ? "active" : ""}
              onClick={() => setTab("field")}
            >
              <Camera />
              Din teren{" "}
              {data.reports.length > 0 && <span className="tab-count">{data.reports.length}</span>}
            </Button>
            <Button
              variant="ghost"
              className={tab === "audit" ? "active" : ""}
              onClick={() => setTab("audit")}
            >
              <History />
              Jurnal
            </Button>
          </div>
          {tab === "proposals" && (
            <div className="panel-filters">
              <div className="search-box">
                <Search />
                <input
                  className="form-control h-9 text-xs"
                  placeholder="Caută propunere, stâlp, tronson…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Caută propuneri"
                />
              </div>
              <div className="filter-wrap">
                <Button
                  variant="outline"
                  className={filter === "all" ? "active" : ""}
                  onClick={() => setFilter("all")}
                >
                  Toate <span className="font-mono">{eligibleProposals.length}</span>
                </Button>
                {types.map((t) => {
                  const count = eligibleProposals.filter((p) => p["tip"] === t).length;
                  return (
                    count > 0 && (
                      <Button
                        key={t}
                        variant="outline"
                        className={filter === t ? "active" : ""}
                        onClick={() => setFilter(t)}
                      >
                        {labels[t]} <span className="font-mono">{count}</span>
                      </Button>
                    )
                  );
                })}
              </div>
              <div className="list-heading">
                <span>{proposals.length} propuneri</span>
                <select
                  aria-label="Filtrează după status"
                  className="bg-transparent text-xs outline-none"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="in_asteptare">În așteptare</option>
                  <option value="aprobat">Aprobate</option>
                  <option value="respins">Respinse</option>
                </select>
              </div>
            </div>
          )}
          <div className="panel-scroll">
            {tab === "proposals" && <ClientBatch proposals={eligibleProposals} verification={clientVerification} />}
            {tab === "osm" && <><div className="p-3 text-xs text-muted-foreground">Etichete din teren · nu certificare electrică.</div>{osmSelected && <Button variant="ghost" size="sm" onClick={() => setOsmSelected(undefined)}>Toate elementele OSM</Button>}<OsmOfficeList data={data} selected={osmSelected} onFocus={setFocus} onReports={() => setTab("field")} /></>}
            {currentInspection && (
              <section className="inspection">
                <div className="inspection-head">
                  <h2>Cât ne bazăm pe asta</h2>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setInspection(undefined)}
                    aria-label="Închide detaliile"
                  >
                    <X />
                  </Button>
                </div>
                <div className="object-id">
                  {currentInspection.id} ·{" "}
                  {currentInspection.kind === "line" ? "tronson" : "zonă 50 × 50 m"}
                </div>
                <div className={`inspection-score ${tone(currentInspection.scor)}`}>
                  {Math.round(currentInspection.scor * 100)}%
                </div>
                <p>Scorul scade cu vechimea verificării și cu fiecare schimbare neconfirmată.</p>
                {currentInspection.unknown && (
                  <div className="notice">Nu se poate verifica din imagine</div>
                )}
                <h3>De ce</h3>
                <ul>
                  {currentInspection.motive.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
                {nearbyP.map((p) => (
                  <Button variant="link" size="sm" key={p["id"]} onClick={() => select(p["id"])}>
                    {p["id"]} · {labels[p["tip"]]} <ArrowUpRight />
                  </Button>
                ))}
                {nearbyR.map((r) => (
                  <p key={r.id}>
                    {r.actor} · raport din teren · {r.status}
                  </p>
                ))}
                {currentInspection.kind === "line" && (
                  <>
                    <h3>Atribute și surse</h3>
                    <dl>
                      {conductor(data, currentInspection.id).map((a) => (
                        <div className="detail-line" key={a.key}>
                          <dt>{humanKey[a.key]}</dt>
                          <dd>
                            {display(a.value)}
                            <br />
                            <span className="text-muted-foreground">
                              {a.value == null ? "necunoscut" : a.source}
                            </span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p>
                      Ultima verificare:{" "}
                      {display(
                        data.layers["gis"]?.features.find(
                          (f) => f.properties?.["id"] === currentInspection.id,
                        )?.properties?.["verified_year"] ||
                          data.layers["gis"]?.features.find(
                            (f) => f.properties?.["id"] === currentInspection.id,
                          )?.properties?.["last_verified"] ||
                          "dată neîncărcată",
                      )}
                    </p>
                  </>
                )}
                <Button
                  variant="outline"
                  disabled={!access.validate}
                  className="w-full mt-4 text-xs"
                  onClick={async () => {
                    try {
                      await audit(actor, `verificare cerută pentru ${currentInspection.id}`);
                      toast.success("Verificarea a fost cerută în jurnal");
                      await client.invalidateQueries({ queryKey: ["gridtwin"] });
                    } catch {
                      toast.error("Cererea nu a fost salvată");
                    }
                  }}
                >
                  <Camera />
                  Cere verificare în teren
                </Button>
              </section>
            )}
            {tab === "proposals" &&
              proposals.map((p) => {
                if (isClient(p)) return <ClientCard key={p.id} proposal={p} busy={clientVerification.busy === p.id} canVerify={access.validate && !!clientVerification.count.data} canUndo={access.validate} onVerify={() => { void clientVerification.verify(p).catch(e => toast.error(e instanceof Error ? e.message : "Verificarea nu a reușit.")); }} onFocus={() => setFocus(p.geometrie)} onUndo={() => void decide(p.id,"proposal","in_asteptare")} />;
                const Icon = tipIcons[p["tip"]] || Activity;
                const reports = data.reports.filter(
                  (r) => r.status !== "respins" && nearby(p["geometrie"], [r.lon, r.lat], 20),
                );
                return (
                  <article
                    key={p["id"]}
                    id={`proposal-${p["id"]}`}
                    className={`proposal-card ${selected === p["id"] ? "selected" : ""}`}
                    onClick={() => {
                      setSelected(p["id"]);
                      setFocus(p["geometrie"]);
                    }}
                  >
                    <div className="proposal-top">
                      <span className="type-badge">
                        <Icon />
                        {labels[p["tip"]]}
                      </span>
                      <span
                        className={`status-badge ${p["status"] === "aprobat" ? "approved" : p["status"] === "respins" ? "rejected" : ""}`}
                      >
                        {p["status"] === "aprobat"
                          ? "Aprobat"
                          : p["status"] === "respins"
                            ? "Respins"
                            : "În așteptare"}
                      </span>
                    </div>
                    <div className="object-id">
                      {p["id"]} · {p["obiect"]}
                    </div>
                    <div className="confidence-row">
                      <span className="text-muted-foreground">Încredere agent</span>
                      <strong className="primary font-mono font-medium">
                        {Math.round(p["incredere"] * 100)}%
                      </strong>
                    </div>
                    <div className="confidence-track">
                      <meter min={0} max={1} value={p["incredere"]} />
                    </div>
                    <p className="proposal-reason">{p["motiv"]}</p>
                    <dl className="proposal-details">
                      {Object.entries(p["propus"]).map(([k, v]) => {
                        const a = inferred(p, k);
                        return (
                          <div className="detail-line" key={k}>
                            <dt>{humanKey[k] || k.replaceAll("_", " ")}</dt>
                            <dd className="detail-value">
                              {p["tip"] === "atribute_lipsa" ? (
                                <>
                                  {display(a.value)} · {Math.round(a.confidence * 100)}%<br />
                                  <span className="text-muted-foreground">
                                    exemple: {display(a.examples)}
                                  </span>
                                </>
                              ) : (
                                display(v)
                              )}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                    {reports.length > 0 && (
                      <div className="confirmed">
                        <ShieldCheck size={12} />
                        confirmat în teren
                      </div>
                    )}
                    <div className="proposal-source">
                      <Link2 />
                      {p["sursa"]}
                    </div>
                    {access.validate && (p["status"] === "in_asteptare" ? (
                      <div className="proposal-actions">
                        <Button
                          variant="approve"
                          disabled={busy === p["id"]}
                          onClick={(e) => {
                            e.stopPropagation();
                            void decide(p["id"], "proposal", "aprobat");
                          }}
                        >
                          <Check />
                          Aprobă
                        </Button>
                        <Button
                          variant="reject"
                          disabled={busy === p["id"]}
                          onClick={(e) => {
                            e.stopPropagation();
                            void decide(p["id"], "proposal", "respins");
                          }}
                        >
                          <X />
                          Respinge
                        </Button>
                        <Button
                          variant="outline"
                          title="Arată pe hartă"
                          aria-label={`Arată ${p["id"]} pe hartă`}
                          onClick={() => setFocus({ ...p["geometrie"] })}
                        >
                          <ArrowUpRight />
                        </Button>
                      </div>
                    ) : (
                      <div className="decision-info">
                        <span>
                          {p["decided_by"]} ·{" "}
                          {p["decided_at"] &&
                            new Date(p["decided_at"]).toLocaleString("ro-RO", {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy === p["id"]}
                          onClick={(e) => {
                            e.stopPropagation();
                            void decide(p["id"], "proposal", "in_asteptare");
                          }}
                        >
                          <Undo2 />
                          Anulează
                        </Button>
                      </div>
                    ))}
                  </article>
                );
              })}
            {tab === "proposals" && !proposals.length && (
              <div className="empty-state">
                <Search />
                <h3>Nicio propunere găsită</h3>
                <p>Nu există propuneri pentru filtrele selectate.</p>
              </div>
            )}
            {tab === "field" &&
              (data.reports.length ? (
                [...data.reports]
                  .sort((a, b) => b.created_at.localeCompare(a.created_at))
                  .map((r) => (
                    <article
                      className="proposal-card"
                      key={r.id}
                      onClick={() => setFocus({ type: "Point", coordinates: [r.lon, r.lat] })}
                    >
                      <div className="proposal-top">
                        <span className="type-badge field">
                          <Camera />
                          Raport din teren
                        </span>
                        <span
                          className={`status-badge ${r.status === "aprobat" ? "approved" : r.status === "respins" ? "rejected" : ""}`}
                        >
                          {r.status === "aprobat"
                            ? "Aprobat"
                            : r.status === "respins"
                              ? "Respins"
                              : "În așteptare"}
                        </span>
                      </div>
                      <div className="object-id">
                        {r.actor} · {r.submitted_team || ""} · {new Date(r.created_at).toLocaleString("ro-RO")}
                      </div>
                      {r.osm_id && <><div className="object-id">OSM · {r.osm_id}</div><h3 className={r.osm_verdict ? osmTones[r.osm_verdict] : "primary"}>{r.osm_verdict && osmVerdicts[r.osm_verdict]} · {r.status === "aprobat" ? "aprobat" : "propus"}</h3><p className="text-xs">{r.evidence_notes}</p><p className="text-xs text-muted-foreground">Verificat: {new Date(r.inspected_at || r.created_at).toLocaleString("ro-RO")}</p></>}
                      <div className="report-photos">
                        <Photo path={r.photo_pole_url} />
                        <Photo path={r.photo_sheet_url} />
                      </div>
                      {!r.osm_id && <p className="text-xs">
                        Stâlp în poză:{" "}
                        {r.pole_check?.valoare === true
                          ? "da"
                          : r.pole_check?.valoare === false
                            ? "nu"
                            : "neconfirmat"}{" "}
                        · {Math.round((r.pole_check?.incredere || 0) * 100)}%{" "}
                        {r.pole_check?.tip_vizibil}
                      </p>}
                      <dl className="proposal-details">
                        {Object.entries(r.fields).map(([k, v]) => (
                          <div key={k} className="detail-line">
                            <dt>{fieldLabels[k] || k}</dt>
                            <dd>
                              {display(v.valoare)}
                              <br />
                              <span className="text-muted-foreground">
                                {v.sursa === "manual"
                                  ? "corectat de echipă"
                                  : `${Math.round(v.incredere * 100)}%`}
                              </span>
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <p className="position-note">
                        {r.pos_source} · {r.lat.toFixed(6)}, {r.lon.toFixed(6)}
                      </p>
                      {!r.osm_id && eligibleProposals
                        .filter((p) => nearby(p["geometrie"], [r.lon, r.lat], 20))
                        .map((p) => (
                          <Button
                            key={p["id"]}
                            variant="link"
                            size="sm"
                            onClick={() => select(p["id"])}
                          >
                            {p["id"]} · {labels[p["tip"]]}
                          </Button>
                        ))}
                      {access.validate && (r.status === "in_asteptare" ? (
                        <div className="proposal-actions mt-3">
                          <Button
                            variant="approve"
                            disabled={busy === r.id}
                            onClick={() => void decide(r.id, "field", "aprobat")}
                          >
                            <Check />
                            {r.osm_id ? "Aprobă eticheta OSM" : "Aprobă și pune în model"}
                          </Button>
                          <Button
                            variant="reject"
                            disabled={busy === r.id}
                            onClick={() => void decide(r.id, "field", "respins")}
                          >
                            <X />
                            Respinge
                          </Button>
                        </div>
                      ) : (
                        <div className="decision-info">
                          {r.decided_by} ·{" "}
                          {r.decided_at && new Date(r.decided_at).toLocaleString("ro-RO")}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void decide(r.id, "field", "in_asteptare")}
                          >
                            <Undo2 />
                            Anulează
                          </Button>
                        </div>
                      ))}
                    </article>
                  ))
              ) : (
                <div className="empty-state">
                  <Camera />
                  <h3>Niciun raport din teren</h3>
                  <p>Rapoartele trimise de echipă vor apărea aici.</p>
                  {access.submit && <Button variant="outline" asChild>
                    <Link to="/teren">
                      Raport nou <ArrowUpRight />
                    </Link>
                  </Button>}
                </div>
              ))}
            {tab === "audit" &&
              (data.audit.length ? (
                [...data.audit]
                  .sort((a, b) => b.at.localeCompare(a.at))
                  .map((a) => (
                    <div className="audit-row" key={a.id}>
                      <span className="audit-icon">
                        <History />
                      </span>
                      <div>
                        <p>{a.text}</p>
                        <small>
                          {a.actor} · {new Date(a.at).toLocaleString("ro-RO")}
                        </small>
                      </div>
                    </div>
                  ))
              ) : (
                <div className="empty-state">
                  <History />
                  <h3>Jurnalul este gol</h3>
                  <p>Nu a fost înregistrată nicio decizie.</p>
                </div>
              ))}
          </div>
          <div className="panel-footer">
            <ShieldCheck />
            Nicio modificare fără aprobarea unui operator.
          </div>
        </aside>
      </div>
    </>
  );
}
