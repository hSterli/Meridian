-- Real file attachments on test cases, backed by Supabase Storage. Objects
-- are stored at `${projectId}/${testCaseId}/${filename}` so storage RLS can
-- gate access purely from the path (via storage.foldername), without a
-- join, matching how project-scoped access is already checked elsewhere.

create table test_case_attachments (
  id uuid primary key default gen_random_uuid(),
  test_case_id uuid not null references test_cases(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  file_size bigint,
  uploaded_by uuid not null references auth.users(id),
  uploaded_at timestamptz not null default now()
);

create index test_case_attachments_test_case_id_idx on test_case_attachments(test_case_id);

alter table test_case_attachments enable row level security;

create policy "members can view attachments" on test_case_attachments
  for select using (
    private.is_org_member(private.project_org_id((select project_id from test_cases where id = test_case_id)))
  );
create policy "members can create attachments" on test_case_attachments
  for insert with check (
    private.is_org_member(private.project_org_id((select project_id from test_cases where id = test_case_id)))
    and uploaded_by = auth.uid()
  );
create policy "members can delete attachments" on test_case_attachments
  for delete using (
    private.is_org_member(private.project_org_id((select project_id from test_cases where id = test_case_id)))
  );

insert into storage.buckets (id, name, public)
values ('test-case-attachments', 'test-case-attachments', false)
on conflict (id) do nothing;

create policy "members can read attachment objects" on storage.objects
  for select using (
    bucket_id = 'test-case-attachments'
    and private.is_org_member(private.project_org_id((storage.foldername(name))[1]::uuid))
  );
create policy "members can upload attachment objects" on storage.objects
  for insert with check (
    bucket_id = 'test-case-attachments'
    and private.is_org_member(private.project_org_id((storage.foldername(name))[1]::uuid))
  );
create policy "members can delete attachment objects" on storage.objects
  for delete using (
    bucket_id = 'test-case-attachments'
    and private.is_org_member(private.project_org_id((storage.foldername(name))[1]::uuid))
  );
