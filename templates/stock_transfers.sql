create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  product_name text not null,
  quantity integer not null check (quantity > 0),
  source_store_id uuid not null,
  target_store_id uuid not null,
  source_product_id uuid,
  target_product_id uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_stock_transfers_source_store on public.stock_transfers(source_store_id);
create index if not exists idx_stock_transfers_target_store on public.stock_transfers(target_store_id);
create index if not exists idx_stock_transfers_created_at on public.stock_transfers(created_at desc);
