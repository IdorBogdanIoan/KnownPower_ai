import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function ReportPhoto({ path, demo = false }: { path: string | null; demo?: boolean }) {
  const [signedUrl, setSignedUrl] = useState("");
  const demoPhoto = demo && path && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(path) ? path : "";
  useEffect(() => {
    setSignedUrl("");
    if (!path || demo) return;
    let alive = true;
    void supabase.storage.from("field-photos").createSignedUrl(path, 3600).then(({ data }) => {
      if (alive) setSignedUrl(data?.signedUrl || "");
    });
    return () => { alive = false; };
  }, [path, demo]);
  const url = demo ? demoPhoto : signedUrl;
  return url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Fotografie raport din teren" /></a> : <div className="bg-muted h-24" />;
}