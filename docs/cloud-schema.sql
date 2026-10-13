-- Decisive cloud schema — run this once in the Supabase SQL editor.
-- One table, one policy: every row belongs to the signed-in user, and Row
-- Level Security makes that rule true for every read and write.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '',
  note text not null default '',
  quadrant text not null default 'do',
  order_index integer not null default 0,
  importance integer not null default 50,
  urgency integer not null default 50,
  due_date date,
  done boolean not null default false,
  done_at timestamptz,
  archived boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists tasks_user_quadrant_idx on public.tasks (user_id, quadrant, order_index);

alter table public.tasks enable row level security;

drop policy if exists "own tasks" on public.tasks;
create policy "own tasks" on public.tasks
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
