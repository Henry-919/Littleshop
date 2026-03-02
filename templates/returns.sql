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

alter table public.returns add column if not exists store_id uuid;
alter table public.returns add column if not exists product_id uuid;
alter table public.returns add column if not exists product_model text;
alter table public.returns add column if not exists invoice_no text;
alter table public.returns add column if not exists amount numeric(12,2);
alter table public.returns add column if not exists quantity integer;
alter table public.returns add column if not exists return_date date;
alter table public.returns add column if not exists created_at timestamptz;
alter table public.returns add column if not exists deleted_at timestamptz;

update public.returns set amount = 0 where amount is null;
update public.returns set quantity = 1 where quantity is null or quantity <= 0;
update public.returns set created_at = now() where created_at is null;
update public.returns set return_date = created_at::date where return_date is null;
update public.returns set product_model = '' where product_model is null;
update public.returns set invoice_no = '' where invoice_no is null;

alter table public.returns alter column amount set default 0;
alter table public.returns alter column created_at set default now();

create index if not exists idx_returns_store_id on public.returns(store_id);
create index if not exists idx_returns_product_id on public.returns(product_id);
create index if not exists idx_returns_return_date on public.returns(return_date desc);
create index if not exists idx_returns_created_at on public.returns(created_at desc);
