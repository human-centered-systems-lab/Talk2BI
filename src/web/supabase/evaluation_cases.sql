create table if not exists public.evaluation_cases (
  id text not null,
  "userId" uuid not null references auth.users(id) on delete cascade,
  question text not null,
  "goldSql" text not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  primary key ("userId", id)
);

alter table public.evaluation_cases enable row level security;

create policy "evaluation_cases_select_own"
  on public.evaluation_cases
  for select
  using (auth.uid() = "userId");

create policy "evaluation_cases_insert_own"
  on public.evaluation_cases
  for insert
  with check (auth.uid() = "userId");

create policy "evaluation_cases_update_own"
  on public.evaluation_cases
  for update
  using (auth.uid() = "userId")
  with check (auth.uid() = "userId");

create policy "evaluation_cases_delete_own"
  on public.evaluation_cases
  for delete
  using (auth.uid() = "userId");

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$;

drop trigger if exists evaluation_cases_set_updated_at on public.evaluation_cases;

create trigger evaluation_cases_set_updated_at
  before update on public.evaluation_cases
  for each row
  execute function public.set_updated_at();

create table if not exists public.evaluation_runs (
  id uuid primary key,
  "userId" uuid not null references auth.users(id) on delete cascade,
  "caseId" text not null,
  question text not null,
  "goldSql" text not null,
  "answerText" text,
  "finalSql" text,
  "executedSql" text,
  status text not null check (status in ('success', 'error')),
  error text,
  "toolTrace" jsonb not null default '[]'::jsonb,
  "createdAt" timestamptz not null default now(),
  foreign key ("userId", "caseId")
    references public.evaluation_cases ("userId", id)
    on delete cascade
);

create index if not exists evaluation_runs_user_case_created_idx
  on public.evaluation_runs ("userId", "caseId", "createdAt" desc);

alter table public.evaluation_runs enable row level security;

create policy "evaluation_runs_select_own"
  on public.evaluation_runs
  for select
  using (auth.uid() = "userId");

create policy "evaluation_runs_insert_own"
  on public.evaluation_runs
  for insert
  with check (auth.uid() = "userId");

create policy "evaluation_runs_delete_own"
  on public.evaluation_runs
  for delete
  using (auth.uid() = "userId");
