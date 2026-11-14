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
- Public routes load one paginated workspace through a publishable-key server function and TanStack Query; Realtime invalidates it to keep the office and field views consistent.
- Leaflet is dynamically imported behind ClientOnly, with browser-safe geometry logic in a separate module, to preserve SSR compatibility.
- Demo decisions and field submission use transactional database functions so audit rows and status changes are saved together; permissive policies are demo-only.
- Compute effective scores and inferred attributes from original imports plus approved reports/proposals, preserving original GIS and supporting undo without destructive edits.
- Store photo object paths, not expiring URLs; request signed URLs for display because workspace policy requires private storage.
- Run vision extraction in a TanStack server function through the AI Gateway SDK, validating model output and retaining manual edits on failure.
