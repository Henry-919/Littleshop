create extension if not exists pgcrypto;

create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  product_name text,
  quantity integer,
  source_store_id text,
  target_store_id text,
  source_product_id text,
  target_product_id text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- 兼容历史字段（老版本可能写入这些列）
alter table public.stock_transfers add column if not exists product text;
alter table public.stock_transfers add column if not exists qty integer;
alter table public.stock_transfers add column if not exists from_store_id text;
alter table public.stock_transfers add column if not exists to_store_id text;
alter table public.stock_transfers add column if not exists source_product_id text;
alter table public.stock_transfers add column if not exists target_product_id text;
alter table public.stock_transfers add column if not exists created_at timestamptz;
alter table public.stock_transfers add column if not exists deleted_at timestamptz;

-- 兼容旧库里 UUID/INT 等不同类型：统一转换为 text，避免 22P02
alter table public.stock_transfers alter column source_store_id type text using source_store_id::text;
alter table public.stock_transfers alter column target_store_id type text using target_store_id::text;
alter table public.stock_transfers alter column from_store_id type text using from_store_id::text;
alter table public.stock_transfers alter column to_store_id type text using to_store_id::text;
alter table public.stock_transfers alter column source_product_id type text using source_product_id::text;
alter table public.stock_transfers alter column target_product_id type text using target_product_id::text;

update public.stock_transfers
set product_name = product
where product_name is null and product is not null;

update public.stock_transfers
set product = product_name
where product is null and product_name is not null;

update public.stock_transfers
set quantity = qty
where quantity is null and qty is not null;

update public.stock_transfers
set qty = quantity
where qty is null and quantity is not null;

update public.stock_transfers
set source_store_id = from_store_id
where source_store_id is null and nullif(trim(from_store_id), '') is not null;

update public.stock_transfers
set from_store_id = source_store_id
where from_store_id is null and nullif(trim(source_store_id), '') is not null;

update public.stock_transfers
set target_store_id = to_store_id
where target_store_id is null and nullif(trim(to_store_id), '') is not null;

update public.stock_transfers
set to_store_id = target_store_id
where to_store_id is null and nullif(trim(target_store_id), '') is not null;

update public.stock_transfers
set created_at = now()
where created_at is null;

alter table public.stock_transfers alter column created_at set default now();

create index if not exists idx_stock_transfers_source_store on public.stock_transfers(source_store_id);
create index if not exists idx_stock_transfers_target_store on public.stock_transfers(target_store_id);
create index if not exists idx_stock_transfers_from_store on public.stock_transfers(from_store_id);
create index if not exists idx_stock_transfers_to_store on public.stock_transfers(to_store_id);
create index if not exists idx_stock_transfers_created_at on public.stock_transfers(created_at desc);

-- Supabase 权限与 RLS（解决 42501）
grant select, insert, update, delete on table public.stock_transfers to anon;
grant select, insert, update, delete on table public.stock_transfers to authenticated;
grant select, insert, update, delete on table public.stock_transfers to service_role;

alter table public.stock_transfers enable row level security;

drop policy if exists stock_transfers_select_all on public.stock_transfers;
create policy stock_transfers_select_all
on public.stock_transfers
for select
to anon, authenticated
using (true);

drop policy if exists stock_transfers_insert_all on public.stock_transfers;
create policy stock_transfers_insert_all
on public.stock_transfers
for insert
to anon, authenticated
with check (true);

drop policy if exists stock_transfers_update_all on public.stock_transfers;
create policy stock_transfers_update_all
on public.stock_transfers
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists stock_transfers_delete_all on public.stock_transfers;
create policy stock_transfers_delete_all
on public.stock_transfers
for delete
to anon, authenticated
using (true);

-- 刷新 PostgREST schema cache，避免出现 “Could not find the table ... in the schema cache”
notify pgrst, 'reload schema';
