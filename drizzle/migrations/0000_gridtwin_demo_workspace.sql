-- Permissive access is intentional ONLY for the requested unauthenticated demo. Do not deploy with sensitive operator data.
CREATE TABLE public.layers (name text PRIMARY KEY, geojson jsonb NOT NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.layers TO anon, authenticated;
GRANT ALL ON public.layers TO service_role;
ALTER TABLE public.layers ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_layers ON public.layers FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE TABLE public.proposals (id text PRIMARY KEY, tip text NOT NULL, obiect text NOT NULL, geometrie jsonb NOT NULL, propus jsonb NOT NULL DEFAULT '{}', sursa text, incredere double precision NOT NULL CHECK (incredere BETWEEN 0 AND 1), motiv text, status text NOT NULL DEFAULT 'in_asteptare' CHECK(status IN ('in_asteptare','aprobat','respins')), decided_by text, decided_at timestamptz);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proposals TO anon, authenticated;
GRANT ALL ON public.proposals TO service_role;
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_proposals ON public.proposals FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE TABLE public.line_scores (id text PRIMARY KEY, geometry jsonb NOT NULL, scor double precision NOT NULL CHECK(scor BETWEEN 0 AND 1), culoare text NOT NULL, motive jsonb NOT NULL DEFAULT '[]');
GRANT SELECT, INSERT, UPDATE, DELETE ON public.line_scores TO anon, authenticated;
GRANT ALL ON public.line_scores TO service_role;
ALTER TABLE public.line_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_scores ON public.line_scores FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE TABLE public.audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), at timestamptz NOT NULL DEFAULT now(), actor text NOT NULL, text text NOT NULL);
GRANT SELECT, INSERT ON public.audit_log TO anon, authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_audit_read ON public.audit_log FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY demo_audit_insert ON public.audit_log FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE TABLE public.field_reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), actor text NOT NULL, status text NOT NULL DEFAULT 'in_asteptare' CHECK(status IN ('in_asteptare','aprobat','respins')), lat double precision NOT NULL, lon double precision NOT NULL, pos_source text, fields jsonb NOT NULL DEFAULT '{}', pole_check jsonb, photo_pole_url text, photo_sheet_url text, decided_by text, decided_at timestamptz);
GRANT SELECT, INSERT, UPDATE ON public.field_reports TO anon, authenticated;
GRANT ALL ON public.field_reports TO service_role;
ALTER TABLE public.field_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_reports ON public.field_reports FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.proposals, public.audit_log, public.field_reports, public.layers, public.line_scores;
CREATE POLICY demo_field_photo_read ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'field-photos');
CREATE POLICY demo_field_photo_insert ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'field-photos');
CREATE FUNCTION public.decide_grid_item(item_id text, item_kind text, decision text, operator_name text) RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF decision NOT IN ('aprobat','respins','in_asteptare') OR length(trim(operator_name)) < 2 THEN RAISE EXCEPTION 'Decizie sau operator invalid'; END IF;
 IF item_kind = 'proposal' THEN
 UPDATE public.proposals SET status = decision, decided_by = CASE WHEN decision='in_asteptare' THEN NULL ELSE operator_name END, decided_at = CASE WHEN decision='in_asteptare' THEN NULL ELSE now() END WHERE id = item_id;
 ELSIF item_kind = 'field' THEN
 UPDATE public.field_reports SET status = decision, decided_by = CASE WHEN decision='in_asteptare' THEN NULL ELSE operator_name END, decided_at = CASE WHEN decision='in_asteptare' THEN NULL ELSE now() END WHERE id = item_id::uuid;
 ELSE RAISE EXCEPTION 'Tip invalid'; END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Înregistrare inexistentă'; END IF;
 INSERT INTO public.audit_log(actor,text) VALUES(operator_name, CASE decision WHEN 'aprobat' THEN 'Aprobat' WHEN 'respins' THEN 'Respins' ELSE 'Decizie anulată pentru' END || ' ' || item_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.decide_grid_item(text,text,text,text) TO anon, authenticated;
CREATE FUNCTION public.submit_field_report(report jsonb) RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE rid uuid;
BEGIN
 IF length(trim(report->>'actor')) < 2 THEN RAISE EXCEPTION 'Operator invalid'; END IF;
 INSERT INTO public.field_reports(actor,lat,lon,pos_source,fields,pole_check,photo_pole_url,photo_sheet_url) VALUES(report->>'actor',(report->>'lat')::double precision,(report->>'lon')::double precision,report->>'pos_source',report->'fields',report->'pole_check',report->>'photo_pole_url',report->>'photo_sheet_url') RETURNING id INTO rid;
 INSERT INTO public.audit_log(actor,text) VALUES(report->>'actor','Raport din teren trimis · ' || rid);
 RETURN rid;
END; $$;
GRANT EXECUTE ON FUNCTION public.submit_field_report(jsonb) TO anon, authenticated;