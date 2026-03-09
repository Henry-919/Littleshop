create extension if not exists pgcrypto;

create table if not exists public.daily_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  date date not null,
  card_amount numeric(12,2) not null default 0,
  cash_amount numeric(12,2) not null default 0,
  transfer_amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.daily_payments add column if not exists store_id uuid;
alter table public.daily_payments add column if not exists date date;
alter table public.daily_payments add column if not exists card_amount numeric(12,2);
alter table public.daily_payments add column if not exists cash_amount numeric(12,2);
alter table public.daily_payments add column if not exists transfer_amount numeric(12,2);
alter table public.daily_payments add column if not exists created_at timestamptz;
alter table public.daily_payments add column if not exists updated_at timestamptz;
alter table public.daily_payments add column if not exists deleted_at timestamptz;
alter table public.daily_payments add column if not exists id uuid default gen_random_uuid();

update public.daily_payments set id = gen_random_uuid() where id is null;

-- 兼容旧库字段类型差异（uuid/text/timestamp/date 混用）
alter table public.daily_payments drop constraint if exists daily_payments_store_id_fkey;
alter table public.daily_payments alter column store_id type uuid using (
  case
    when store_id is null then null
    when nullif(trim(store_id::text), '') is null then null
    when store_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then store_id::text::uuid
    else null
  end
);
alter table public.daily_payments alter column date type date using nullif(date::text, '')::date;
alter table public.daily_payments alter column card_amount type numeric(12,2) using coalesce(card_amount, 0)::numeric(12,2);
alter table public.daily_payments alter column cash_amount type numeric(12,2) using coalesce(cash_amount, 0)::numeric(12,2);
alter table public.daily_payments alter column transfer_amount type numeric(12,2) using coalesce(transfer_amount, 0)::numeric(12,2);
alter table public.daily_payments alter column created_at type timestamptz using coalesce(created_at, now());
alter table public.daily_payments alter column updated_at type timestamptz using coalesce(updated_at, now());

update public.daily_payments set card_amount = 0 where card_amount is null;
update public.daily_payments set cash_amount = 0 where cash_amount is null;
update public.daily_payments set transfer_amount = 0 where transfer_amount is null;
update public.daily_payments set created_at = now() where created_at is null;
update public.daily_payments set updated_at = now() where updated_at is null;

-- 清理非法主键维度数据，避免 not null / unique 约束失败
delete from public.daily_payments
where store_id is null
  or nullif(trim(store_id::text), '') is null
   or date is null;

-- 清理重复 (store_id, date) 记录，保留最近更新时间的一条
with ranked as (
  select
    ctid,
    row_number() over (
      partition by store_id, date
      order by coalesce(updated_at, created_at, now()) desc, ctid desc
    ) as rn
  from public.daily_payments
)
delete from public.daily_payments d
using ranked r
where d.ctid = r.ctid
  and r.rn > 1;

alter table public.daily_payments alter column store_id set not null;
alter table public.daily_payments alter column date set not null;
alter table public.daily_payments alter column card_amount set not null;
alter table public.daily_payments alter column cash_amount set not null;
alter table public.daily_payments alter column transfer_amount set not null;
alter table public.daily_payments alter column card_amount set default 0;
alter table public.daily_payments alter column cash_amount set default 0;
alter table public.daily_payments alter column transfer_amount set default 0;
alter table public.daily_payments alter column created_at set default now();
alter table public.daily_payments alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'daily_payments_store_date_key'
      and conrelid = 'public.daily_payments'::regclass
  ) then
    alter table public.daily_payments
      add constraint daily_payments_store_date_key unique (store_id, date);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'daily_payments_store_id_fkey'
      and conrelid = 'public.daily_payments'::regclass
  ) then
    alter table public.daily_payments
      add constraint daily_payments_store_id_fkey
      foreign key (store_id) references public.stores(id) on update cascade on delete cascade;
  end if;
end $$;

create index if not exists idx_daily_payments_store_date on public.daily_payments(store_id, date);
create index if not exists idx_daily_payments_date on public.daily_payments(date desc);

create or replace function public.set_daily_payments_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_daily_payments_updated_at on public.daily_payments;
create trigger trg_daily_payments_updated_at
before update on public.daily_payments
for each row
execute function public.set_daily_payments_updated_at();

grant select, insert, update, delete on table public.daily_payments to anon;
grant select, insert, update, delete on table public.daily_payments to authenticated;
grant select, insert, update, delete on table public.daily_payments to service_role;

alter table public.daily_payments enable row level security;

drop policy if exists daily_payments_select_all on public.daily_payments;
create policy daily_payments_select_all
on public.daily_payments
for select
to anon, authenticated
using (true);

drop policy if exists daily_payments_insert_all on public.daily_payments;
create policy daily_payments_insert_all
on public.daily_payments
for insert
to anon, authenticated
with check (true);

drop policy if exists daily_payments_update_all on public.daily_payments;
create policy daily_payments_update_all
on public.daily_payments
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists daily_payments_delete_all on public.daily_payments;
create policy daily_payments_delete_all
on public.daily_payments
for delete
to anon, authenticated
using (true);

notify pgrst, 'reload schema';
