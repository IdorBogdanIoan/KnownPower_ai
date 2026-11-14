CREATE TABLE public.demo_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 3000000 AND payload->>'fictional' = 'true'),
 status text NOT NULL DEFAULT 'in_asteptare' CHECK (status IN ('in_asteptare','aprobat','respins')),
 decided_by text CHECK (length(decided_by) <= 100),
 decided_at timestamptz
);
GRANT SELECT, INSERT ON public.demo_reports TO anon, authenticated;
GRANT UPDATE (status, decided_by, decided_at) ON public.demo_reports TO anon, authenticated;
GRANT ALL ON public.demo_reports TO service_role;
ALTER TABLE public.demo_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_public_read ON public.demo_reports FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY demo_fictional_insert ON public.demo_reports FOR INSERT TO anon, authenticated WITH CHECK (payload->>'fictional' = 'true' AND status = 'in_asteptare' AND decided_by IS NULL AND decided_at IS NULL);
CREATE POLICY demo_public_decision ON public.demo_reports FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (payload->>'fictional' = 'true');
COMMENT ON TABLE public.demo_reports IS 'Public fictional demo reports only. Never store personal data or real network evidence here. Self-selected demo roles are not authorization.';