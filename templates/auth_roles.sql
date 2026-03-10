create extension if not exists pgcrypto;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  email text unique,
  role text not null check (role in ('admin', 'viewer')) default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.role = 'admin'
      and (
        ur.user_id = auth.uid()
        or (
          ur.email is not null
          and ur.email <> ''
          and lower(ur.email) = lower(coalesce(auth.jwt()->>'email', ''))
        )
      )
  );
$$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_admin() to service_role;

drop trigger if exists trg_user_roles_updated_at on public.user_roles;
create trigger trg_user_roles_updated_at
before update on public.user_roles
for each row
execute function public.set_updated_at();

revoke all on table public.user_roles from anon;
grant select on table public.user_roles to authenticated;
grant all on table public.user_roles to service_role;

alter table public.user_roles enable row level security;

drop policy if exists "read own or admin user roles" on public.user_roles;
create policy "read own or admin user roles"
on public.user_roles
for select
to authenticated
using (
  user_id = auth.uid()
  or (
    email is not null
    and email <> ''
    and lower(email) = lower(coalesce(auth.jwt()->>'email', ''))
  )
  or public.is_admin()
);

drop policy if exists "admin manage user roles" on public.user_roles;
create policy "admin manage user roles"
on public.user_roles
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Example seed records:
-- insert into public.user_roles (user_id, email, role)
-- values ('YOUR_AUTH_USER_ID', 'admin@example.com', 'admin');
