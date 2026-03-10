begin;

create or replace function public.is_authenticated_user()
returns boolean
language sql
stable
as $$
  select auth.role() = 'authenticated';
$$;

grant execute on function public.is_authenticated_user() to authenticated;
grant execute on function public.is_authenticated_user() to service_role;

do $$
begin
  if to_regclass('public.user_roles') is null then
    raise exception 'public.user_roles does not exist. Run templates/auth_roles.sql first.';
  end if;
end
$$;

do $$
declare
  tbl text;
  policy_name text;
  tables text[] := array[
    'stores',
    'categories',
    'products',
    'sales',
    'returns',
    'daily_payments',
    'stock_transfers'
  ];
begin
  foreach tbl in array tables loop
    if to_regclass(format('public.%s', tbl)) is null then
      continue;
    end if;

    execute format('revoke all on table public.%I from anon', tbl);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', tbl);
    execute format('grant select, insert, update, delete on table public.%I to service_role', tbl);
    execute format('alter table public.%I enable row level security', tbl);

    for policy_name in
      select p.policyname
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = tbl
    loop
      execute format('drop policy if exists %I on public.%I', policy_name, tbl);
    end loop;

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_authenticated_user())',
      tbl || '_read_authenticated',
      tbl
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_admin())',
      tbl || '_insert_admin',
      tbl
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())',
      tbl || '_update_admin',
      tbl
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_admin())',
      tbl || '_delete_admin',
      tbl
    );
  end loop;
end
$$;

notify pgrst, 'reload schema';

commit;
