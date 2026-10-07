-- ============================================================
-- 001_initial.sql — ReadTrack initial schema
-- ============================================================

-- profiles
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('student','teacher')),
  face_embedding jsonb null,
  created_at timestamptz default now()
);

-- documents
create table documents (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  file_path text not null,
  file_type text not null check (file_type in ('pdf','docx')),
  created_at timestamptz default now()
);

-- assignments
create table assignments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  unique(document_id, student_id)
);

-- reading_sessions
create table reading_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  started_at timestamptz default now(),
  ended_at timestamptz null,
  active_seconds int default 0,
  idle_seconds int default 0,
  last_page int default 1
);

-- ============================================================
-- Row Level Security
-- ============================================================

alter table profiles enable row level security;
alter table documents enable row level security;
alter table assignments enable row level security;
alter table reading_sessions enable row level security;

-- profiles: user reads/updates own row
create policy "users read own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "users update own profile"
  on profiles for update
  using (auth.uid() = id);

-- documents: teachers manage their own; students see docs assigned to them
create policy "teachers manage own docs"
  on documents for all
  using (auth.uid() = teacher_id);

create policy "students see assigned docs"
  on documents for select
  using (
    exists (
      select 1 from assignments
      where assignments.document_id = documents.id
        and assignments.student_id = auth.uid()
    )
  );

-- assignments: teachers manage assignments for their docs; students see own
create policy "teachers manage assignments"
  on assignments for all
  using (
    exists (
      select 1 from documents
      where documents.id = assignments.document_id
        and documents.teacher_id = auth.uid()
    )
  );

create policy "students see own assignments"
  on assignments for select
  using (auth.uid() = student_id);

-- reading_sessions: students CRUD own sessions; teachers read sessions for their docs
create policy "students manage own sessions"
  on reading_sessions for all
  using (auth.uid() = student_id);

create policy "teachers read sessions for own docs"
  on reading_sessions for select
  using (
    exists (
      select 1 from documents
      where documents.id = reading_sessions.document_id
        and documents.teacher_id = auth.uid()
    )
  );

-- ============================================================
-- Storage bucket + policies
-- ============================================================

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict do nothing;

create policy "teachers upload docs"
  on storage.objects for insert
  with check (
    bucket_id = 'documents' and auth.role() = 'authenticated'
  );

create policy "authenticated users read docs"
  on storage.objects for select
  using (
    bucket_id = 'documents' and auth.role() = 'authenticated'
  );

-- ============================================================
-- Trigger: auto-insert profile on new user signup
-- ============================================================

create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'student')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
