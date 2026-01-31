-- Enable Row Level Security on seo_documents table
ALTER TABLE public.seo_documents ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users and the service role to read rows
CREATE POLICY "Authenticated can select seo_documents"
	ON public.seo_documents
	FOR SELECT
	USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Allow authenticated users and the service role to insert rows
CREATE POLICY "Authenticated can insert seo_documents"
	ON public.seo_documents
	FOR INSERT
	WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Allow authenticated users and the service role to update rows
CREATE POLICY "Authenticated can update seo_documents"
	ON public.seo_documents
	FOR UPDATE
	USING (auth.role() = 'authenticated' OR auth.role() = 'service_role')
	WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Allow authenticated users and the service role to delete rows
CREATE POLICY "Authenticated can delete seo_documents"
	ON public.seo_documents
	FOR DELETE
	USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');