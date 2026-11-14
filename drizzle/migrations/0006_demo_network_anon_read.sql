GRANT SELECT ON public.layers, public.proposals, public.line_scores TO anon;
CREATE POLICY layers_demo_read ON public.layers FOR SELECT TO anon USING (true);
CREATE POLICY proposals_demo_read ON public.proposals FOR SELECT TO anon USING (true);
CREATE POLICY scores_demo_read ON public.line_scores FOR SELECT TO anon USING (true);