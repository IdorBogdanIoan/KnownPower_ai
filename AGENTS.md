<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## GridTwin architecture
- Share browser-safe map status selection and unsafe proposal eligibility across map, review lists and batches; match proposals by explicit object/affected IDs or identical geometry to effective danger scores or approved matching OSM inspections, never by proximity or approval status, so missing validation cannot create eligibility. Preserve stored proposals and evidence.
- Network status overlays show only scored GIS or approved matching-geometry OSM inspections; preserve all imported objects for field inspection without assigning missing evidence a safety category.
- Validate file imports in a browser-safe shared parser; use known filename aliases or an explicit destination for renamed files so data never silently enters the wrong layer.
- OSM inspections use explicit OSM IDs, immutable geometry snapshots and evidence in field reports; only the newest approved matching-geometry inspection colors an object, and OSM reports never affect simulated scores.
- Keep OSM imports in the existing layers store under a distinct key with provenance metadata; fetch only a fixed Constanța study area, reject partial exports, require operator confirmation and never merge OSM into company GIS or simulated scores. Coverage cells express cartographic uncertainty, not verified network absence or completeness.
- Authenticated routes load one paginated workspace through an authenticated server function and TanStack Query; Realtime invalidates it to keep the office and field views consistent.
- Normalize workspace payloads at both fetch and cache-read boundaries so older hydrated strings or missing collections cannot blank public pages.
- Leaflet is dynamically imported behind ClientOnly, with browser-safe geometry logic in a separate module, to preserve SSR compatibility.
- Use a browser-only OpenFreeMap MapLibre layer for the keyless street background, explicitly configuring the Vite worker URL so published maps do not fail to load workers; retain Leaflet overlays and the satellite background.
- Account roles live in protected user_roles, separate from editable name/team profiles; database policies and transactional RPCs enforce access and derive audit identity from auth.uid() because UI visibility is not authorization.
- Application settings use an admin-writable store read by the office view; new accounts default to read-only and the initial real administrator must be explicitly identified, never auto-promoted.
- Name/role test sessions are sessionStorage-only UI previews using the original supplied simulated outputs; never attach credentials, read private Cloud data or write real data from this mode, because self-selected roles are not authorization.
- Compute effective scores and inferred attributes from original imports plus approved reports/proposals, preserving original GIS and supporting undo without destructive edits.
- Store photo object paths, not expiring URLs; request signed URLs for display because workspace policy requires private storage.
- Run vision extraction in a TanStack server function through the AI Gateway SDK, validating model output and retaining manual edits on failure.
- Client document verification is authenticated, address-bound and conservative; a transactional compare-and-save operation records evidence and approvals, while missing GIS geometry never creates a connection.
