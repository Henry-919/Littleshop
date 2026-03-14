create extension if not exists pgcrypto;

create table if not exists public.store_activity_records (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  record_type text not null,
  sort_time timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.store_activity_records add column if not exists id uuid default gen_random_uuid();
alter table public.store_activity_records add column if not exists store_id uuid;
alter table public.store_activity_records add column if not exists record_type text;
alter table public.store_activity_records add column if not exists sort_time timestamptz;
alter table public.store_activity_records add column if not exists payload jsonb default '{}'::jsonb;
alter table public.store_activity_records add column if not exists created_at timestamptz;
alter table public.store_activity_records add column if not exists deleted_at timestamptz;

update public.store_activity_records set id = gen_random_uuid() where id is null;
update public.store_activity_records set sort_time = coalesce(sort_time, created_at, now()) where sort_time is null;
update public.store_activity_records set payload = '{}'::jsonb where payload is null;
update public.store_activity_records set created_at = coalesce(created_at, sort_time, now()) where created_at is null;

delete from public.store_activity_records
where store_id is null
  or nullif(trim(coalesce(record_type, '')), '') is null;

alter table public.store_activity_records alter column store_id set not null;
alter table public.store_activity_records alter column record_type set not null;
alter table public.store_activity_records alter column sort_time set not null;
alter table public.store_activity_records alter column payload set not null;
alter table public.store_activity_records alter column created_at set not null;
alter table public.store_activity_records alter column sort_time set default now();
alter table public.store_activity_records alter column payload set default '{}'::jsonb;
alter table public.store_activity_records alter column created_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'store_activity_records_record_type_check'
      and conrelid = 'public.store_activity_records'::regclass
  ) then
    alter table public.store_activity_records
      add constraint store_activity_records_record_type_check
      check (record_type in ('pos_entry', 'receipt_recognition', 'stock_batch_history', 'inbound_log'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'store_activity_records_store_id_fkey'
      and conrelid = 'public.store_activity_records'::regclass
  ) then
    alter table public.store_activity_records
      add constraint store_activity_records_store_id_fkey
      foreign key (store_id) references public.stores(id) on update cascade on delete cascade;
  end if;
end $$;

create index if not exists idx_store_activity_records_store_type_time
  on public.store_activity_records(store_id, record_type, sort_time desc);

create index if not exists idx_store_activity_records_store_time
  on public.store_activity_records(store_id, sort_time desc);

grant select, insert, update, delete on table public.store_activity_records to anon;
grant select, insert, update, delete on table public.store_activity_records to authenticated;
grant select, insert, update, delete on table public.store_activity_records to service_role;

alter table public.store_activity_records enable row level security;

drop policy if exists store_activity_records_select_all on public.store_activity_records;
create policy store_activity_records_select_all
on public.store_activity_records
for select
to anon, authenticated
using (true);

drop policy if exists store_activity_records_insert_all on public.store_activity_records;
create policy store_activity_records_insert_all
on public.store_activity_records
for insert
to anon, authenticated
with check (true);

drop policy if exists store_activity_records_update_all on public.store_activity_records;
create policy store_activity_records_update_all
on public.store_activity_records
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists store_activity_records_delete_all on public.store_activity_records;
create policy store_activity_records_delete_all
on public.store_activity_records
for delete
to anon, authenticated
using (true);

notify pgrst, 'reload schema';
