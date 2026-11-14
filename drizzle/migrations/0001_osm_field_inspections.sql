ALTER TABLE public.field_reports ADD COLUMN osm_id text, ADD COLUMN osm_verdict text, ADD COLUMN evidence_notes text, ADD COLUMN inspected_at timestamptz, ADD COLUMN osm_geometry jsonb;
CREATE FUNCTION public.validate_osm_inspection() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF NEW.osm_id IS NOT NULL THEN
  IF NEW.osm_id !~ '^(node|way|relation)/[0-9]+$' OR NEW.osm_verdict IS NULL OR NEW.osm_verdict NOT IN ('sigur','de_verificat','nesigur') OR NEW.evidence_notes IS NULL OR length(trim(NEW.evidence_notes)) NOT BETWEEN 10 AND 3000 OR length(trim(NEW.actor)) NOT BETWEEN 2 AND 100 OR NEW.lat NOT BETWEEN 44.1 AND 44.28 OR NEW.lon NOT BETWEEN 28.52 AND 28.72 OR NEW.photo_pole_url IS NULL OR NEW.photo_pole_url !~ '^[0-9a-f-]{36}/pole\.jpg$' OR NEW.inspected_at IS NULL OR NEW.osm_geometry IS NULL THEN RAISE EXCEPTION 'Verificare OSM incompletă: fotografie, observații, inspector și poziție obligatorii'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='field-photos' AND name=NEW.photo_pole_url) THEN RAISE EXCEPTION 'Fotografia nu este înregistrată'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER validate_osm_inspection BEFORE INSERT OR UPDATE ON public.field_reports FOR EACH ROW EXECUTE FUNCTION public.validate_osm_inspection();
CREATE FUNCTION public.submit_osm_inspection(report jsonb) RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE rid uuid; geom jsonb;
BEGIN
 SELECT f->'geometry' INTO geom FROM public.layers l, jsonb_array_elements(l.geojson->'features') f WHERE l.name='osm_constanta' AND f->'properties'->>'osm_id'=report->>'osm_id' LIMIT 1;
 IF geom IS NULL THEN RAISE EXCEPTION 'Element OSM absent din importul curent'; END IF;
 INSERT INTO public.field_reports(actor,lat,lon,pos_source,fields,photo_pole_url,osm_id,osm_verdict,evidence_notes,inspected_at,osm_geometry) VALUES (report->>'actor',(report->>'lat')::double precision,(report->>'lon')::double precision,report->>'pos_source','{}',report->>'photo_pole_url',report->>'osm_id',report->>'osm_verdict',report->>'evidence_notes',now(),geom) RETURNING id INTO rid;
 INSERT INTO public.audit_log(actor,text) VALUES(report->>'actor','Verificare OSM trimisă · ' || (report->>'osm_id') || ' · etichetă propusă: ' || (report->>'osm_verdict') || ' · ' || rid);
 RETURN rid;
END; $$;
GRANT EXECUTE ON FUNCTION public.submit_osm_inspection(jsonb) TO anon, authenticated;
COMMENT ON FUNCTION public.submit_osm_inspection(jsonb) IS 'Demo-only permissive access, matching the existing operator-name demo; no authenticated inspector identity is claimed.';
CREATE OR REPLACE FUNCTION public.decide_grid_item(item_id text, item_kind text, decision text, operator_name text) RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE target_osm text; verdict text;
BEGIN
 IF decision NOT IN ('aprobat','respins','in_asteptare') OR length(trim(operator_name)) < 2 THEN RAISE EXCEPTION 'Decizie sau operator invalid'; END IF;
 IF item_kind = 'proposal' THEN
 UPDATE public.proposals SET status = decision, decided_by = CASE WHEN decision='in_asteptare' THEN NULL ELSE operator_name END, decided_at = CASE WHEN decision='in_asteptare' THEN NULL ELSE now() END WHERE id = item_id;
 ELSIF item_kind = 'field' THEN
 UPDATE public.field_reports SET status = decision, decided_by = CASE WHEN decision='in_asteptare' THEN NULL ELSE operator_name END, decided_at = CASE WHEN decision='in_asteptare' THEN NULL ELSE now() END WHERE id = item_id::uuid RETURNING osm_id, osm_verdict INTO target_osm, verdict;
 ELSE RAISE EXCEPTION 'Tip invalid'; END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Înregistrare inexistentă'; END IF;
 INSERT INTO public.audit_log(actor,text) VALUES(operator_name, CASE decision WHEN 'aprobat' THEN 'Aprobat' WHEN 'respins' THEN 'Respins' ELSE 'Decizie anulată pentru' END || ' ' || item_id || CASE WHEN target_osm IS NOT NULL THEN ' · OSM ' || target_osm || ' · ' || verdict ELSE '' END);
END; $$;