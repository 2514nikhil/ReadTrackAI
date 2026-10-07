-- Teacher-managed student roster. Students must already have a ReadTrack account.
create table teacher_students (
  teacher_id uuid not null references profiles(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (teacher_id, student_id),
  check (teacher_id <> student_id)
);

alter table teacher_students enable row level security;

create policy "teachers manage own student roster"
  on teacher_students for all
  using (auth.uid() = teacher_id)
  with check (auth.uid() = teacher_id);

create policy "students see own teacher roster"
  on teacher_students for select
  using (auth.uid() = student_id);