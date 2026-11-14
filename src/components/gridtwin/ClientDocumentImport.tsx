import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Upload, Loader2 } from "lucide-react";
import { importClientDocuments } from "@/lib/gridtwin/client.functions";
import { useAccount } from "./Account";
import { testWriteNotice } from "@/lib/gridtwin/test-session";
export function ClientDocumentImport() {
  const account = useAccount(); const run = useServerFn(importClientDocuments); const client = useQueryClient();
  const [files,setFiles] = useState<File[]>([]); const [busy,setBusy] = useState(false); const [message,setMessage] = useState("");
  return <section className="import-section"><h2 className="section-title">Contracte și rapoarte</h2>
    <input className="form-control" aria-label="Contracte și rapoarte" type="file" multiple accept=".txt,.json" disabled={busy} onChange={e => { setFiles(Array.from(e.target.files || [])); setMessage(""); }} />
    <Button className="mt-3" disabled={busy || !files.length} onClick={async () => { if (account.test) { setMessage(testWriteNotice); return; } setBusy(true); try { const result = await run({ data: { files: await Promise.all(files.map(async f => ({ name:f.name,text:await f.text() }))) } }); setMessage(`${result.imported} documente importate`); await client.invalidateQueries({ queryKey:["client-documents-count"] }); } catch(e) { setMessage(e instanceof Error ? e.message : "Importul nu a reușit."); } finally { setBusy(false); } }}>{busy ? <Loader2 className="animate-spin" /> : <Upload />}Importă documentele</Button>
    {message && <p className="mt-3 text-sm" role="status">{message}</p>}
  </section>;
}