CREATE TABLE public.client_documents(id text PRIMARY KEY,kind text NOT NULL,pod text,data date,text text NOT NULL,text_norm text NOT NULL,imported_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.client_documents TO authenticated;
GRANT INSERT,UPDATE,DELETE ON public.client_documents TO authenticated;
GRANT ALL ON public.client_documents TO service_role;
ALTER TABLE public.client_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY client_document_read ON public.client_documents FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'validation_team'));
CREATE POLICY client_document_admin ON public.client_documents FOR ALL TO authenticated USING(public.has_role(auth.uid(),'admin')) WITH CHECK(public.has_role(auth.uid(),'admin'));
CREATE FUNCTION public.normalize_client_text(value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$ SELECT trim(regexp_replace(regexp_replace(regexp_replace(lower(translate(value,'ăâîșşțţĂÂÎȘŞȚŢ','aaiss ttAAISS TT')), '\m(str|strada|nr|numar|numarul)\M',' ','g'),'[^a-z0-9]',' ','g'),'\s+',' ','g')); $$;
CREATE FUNCTION public.normalize_client_document() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN NEW.text_norm:=public.normalize_client_text(NEW.text); NEW.imported_at:=clock_timestamp(); RETURN NEW; END; $$;
CREATE TRIGGER normalize_client_document BEFORE INSERT OR UPDATE ON public.client_documents FOR EACH ROW EXECUTE FUNCTION public.normalize_client_document();
CREATE FUNCTION public.match_client_documents(address text) RETURNS SETOF public.client_documents LANGUAGE sql STABLE SET search_path=public AS $$ SELECT * FROM public.client_documents WHERE length(public.normalize_client_text(address))>0 AND text_norm ~ ('\m'||replace(public.normalize_client_text(address),' ',' +')||'\M') ORDER BY data ASC NULLS FIRST,imported_at ASC,id ASC; $$;
REVOKE EXECUTE ON FUNCTION public.match_client_documents(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.match_client_documents(text) TO authenticated;
CREATE FUNCTION public.save_client_verification(proposal_id text,expected jsonb,documents_snapshot jsonb,verification jsonb,line_geometry jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE p public.proposals; current_docs jsonb; new_props jsonb; result text; BEGIN
 IF NOT(public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'validation_team')) THEN RAISE EXCEPTION 'Acces interzis'; END IF;
 SELECT * INTO p FROM public.proposals WHERE id=proposal_id FOR UPDATE;
 IF NOT FOUND OR p.tip NOT IN ('verificare_teren','bransament_lipsa') THEN RAISE EXCEPTION 'Client inexistent'; END IF;
 IF jsonb_build_object('propus',p.propus,'status',p.status,'geometrie',p.geometrie,'tip',p.tip)<>expected THEN RAISE EXCEPTION 'Propunerea s-a schimbat; reîncearcă'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.data ASC NULLS FIRST,d.imported_at,d.id),'[]'::jsonb) INTO current_docs FROM public.match_client_documents(p.propus->>'adresa') d;
 IF current_docs<>documents_snapshot THEN RAISE EXCEPTION 'Documentele s-au schimbat; reîncearcă'; END IF;
 result:=verification->>'rezultat';
 IF result NOT IN ('subteran','aerian','necunoscut','fara_document') THEN RAISE EXCEPTION 'Rezultat invalid'; END IF;
 new_props:=p.propus||jsonb_build_object('verificare',verification);
 IF result='subteran' AND line_geometry IS NOT NULL AND line_geometry->>'type'='LineString' THEN
 new_props:=(new_props-'flag')||jsonb_build_object('tip_racord','subteran','contract_original',coalesce(p.propus->'contract_original',jsonb_build_object('tip',p.tip,'geometrie',p.geometrie)));
 UPDATE public.proposals SET tip='bransament_lipsa',geometrie=line_geometry,propus=new_props,status='aprobat',decided_by='GridTwin (contract)',decided_at=now(),validated_by=auth.uid() WHERE id=proposal_id;
 INSERT INTO public.audit_log(actor,text) VALUES(public.gridtwin_actor(),'Conectat automat din '||(verification->>'document')||': '||(verification->>'dovada'));
 ELSE
 UPDATE public.proposals SET tip='verificare_teren',propus=new_props||jsonb_build_object('flag','echipa_teren'),status='in_asteptare',decided_by=NULL,decided_at=NULL,validated_by=NULL WHERE id=proposal_id;
 INSERT INTO public.audit_log(actor,text) VALUES(public.gridtwin_actor(),'Trimis la echipa din teren: '||coalesce(verification->>'dovada','Fără document'));
 END IF;
 END; $$;
REVOKE EXECUTE ON FUNCTION public.save_client_verification(text,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_client_verification(text,jsonb,jsonb,jsonb,jsonb) TO authenticated;