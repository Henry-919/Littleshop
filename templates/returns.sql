create table if not exists public.returns (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  product_id uuid,
  product_model text not null,
  invoice_no text not null,
  amount numeric(12,2) not null default 0,
  quantity integer not null check (quantity > 0),
  return_date date not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_returns_store_id on public.returns(store_id);
create index if not exists idx_returns_product_id on public.returns(product_id);
create index if not exists idx_returns_return_date on public.returns(return_date desc);
create index if not exists idx_returns_created_at on public.returns(created_at desc);
