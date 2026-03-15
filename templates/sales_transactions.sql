begin;

do $$
begin
  if to_regclass('public.products') is null then
    raise exception 'public.products does not exist. Run the base schema first.';
  end if;

  if to_regclass('public.sales') is null then
    raise exception 'public.sales does not exist. Run the base schema first.';
  end if;
end
$$;

create or replace function public.create_sale_with_stock(
  p_store_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_salesperson text,
  p_sale_date timestamptz,
  p_total_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_updated_product public.products%rowtype;
  v_sale public.sales%rowtype;
  v_salesperson text;
  v_sale_date timestamptz;
  v_total_amount numeric(12,2);
begin
  if not public.is_admin() then
    raise exception 'permission_denied';
  end if;

  if p_store_id is null then
    raise exception 'store_id is required';
  end if;

  if p_product_id is null then
    raise exception 'product_id is required';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be greater than 0';
  end if;

  select *
  into v_product
  from public.products
  where id = p_product_id
    and store_id = p_store_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'product_not_found';
  end if;

  v_salesperson := nullif(trim(coalesce(p_salesperson, '')), '');
  if v_salesperson is null then
    v_salesperson := '系统默认';
  end if;

  v_sale_date := coalesce(p_sale_date, now());
  v_total_amount := round(
    coalesce(
      case when p_total_amount is not null and p_total_amount > 0 then p_total_amount end,
      coalesce(v_product.price, 0) * p_quantity
    )::numeric,
    2
  );

  update public.products
  set stock = coalesce(stock, 0) - p_quantity
  where id = v_product.id
  returning *
  into v_updated_product;

  insert into public.sales (
    product_id,
    quantity,
    total_amount,
    salesperson,
    date,
    store_id
  )
  values (
    p_product_id,
    p_quantity,
    v_total_amount,
    v_salesperson,
    v_sale_date,
    p_store_id
  )
  returning *
  into v_sale;

  return jsonb_build_object(
    'sale',
    jsonb_build_object(
      'id', v_sale.id,
      'productId', v_sale.product_id,
      'productName', coalesce(v_updated_product.name, v_product.name),
      'quantity', v_sale.quantity,
      'totalAmount', v_sale.total_amount,
      'salesperson', v_sale.salesperson,
      'date', v_sale.date
    ),
    'product',
    to_jsonb(v_updated_product)
  );
end;
$$;

create or replace function public.soft_delete_sale_with_stock(
  p_store_id uuid,
  p_sale_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales%rowtype;
  v_product public.products%rowtype;
  v_updated_product public.products%rowtype;
begin
  if not public.is_admin() then
    raise exception 'permission_denied';
  end if;

  if p_store_id is null then
    raise exception 'store_id is required';
  end if;

  if p_sale_id is null then
    raise exception 'sale_id is required';
  end if;

  select *
  into v_sale
  from public.sales
  where id = p_sale_id
    and store_id = p_store_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'sale_not_found';
  end if;

  select *
  into v_product
  from public.products
  where id = v_sale.product_id
    and store_id = p_store_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'product_not_found';
  end if;

  update public.products
  set stock = coalesce(stock, 0) + coalesce(v_sale.quantity, 0)
  where id = v_product.id
  returning *
  into v_updated_product;

  update public.sales
  set deleted_at = now()
  where id = v_sale.id;

  return jsonb_build_object(
    'saleId',
    v_sale.id,
    'product',
    to_jsonb(v_updated_product)
  );
end;
$$;

create or replace function public.update_sale_with_stock(
  p_store_id uuid,
  p_sale_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_total_amount numeric,
  p_salesperson text,
  p_sale_date timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales%rowtype;
  v_old_product public.products%rowtype;
  v_new_product public.products%rowtype;
  v_old_updated public.products%rowtype;
  v_new_updated public.products%rowtype;
  v_same_product boolean;
  v_salesperson text;
  v_sale_date timestamptz;
  v_total_amount numeric(12,2);
  v_reference_price numeric(12,2);
begin
  if not public.is_admin() then
    raise exception 'permission_denied';
  end if;

  if p_store_id is null then
    raise exception 'store_id is required';
  end if;

  if p_sale_id is null then
    raise exception 'sale_id is required';
  end if;

  if p_product_id is null then
    raise exception 'product_id is required';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be greater than 0';
  end if;

  select *
  into v_sale
  from public.sales
  where id = p_sale_id
    and store_id = p_store_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'sale_not_found';
  end if;

  v_same_product := p_product_id = v_sale.product_id;

  if v_same_product then
    select *
    into v_old_product
    from public.products
    where id = v_sale.product_id
      and store_id = p_store_id
      and deleted_at is null
    for update;

    if not found then
      raise exception 'product_not_found';
    end if;
  else
    if v_sale.product_id::text <= p_product_id::text then
      select *
      into v_old_product
      from public.products
      where id = v_sale.product_id
        and store_id = p_store_id
        and deleted_at is null
      for update;

      if not found then
        raise exception 'old_product_not_found';
      end if;

      select *
      into v_new_product
      from public.products
      where id = p_product_id
        and store_id = p_store_id
        and deleted_at is null
      for update;

      if not found then
        raise exception 'new_product_not_found';
      end if;
    else
      select *
      into v_new_product
      from public.products
      where id = p_product_id
        and store_id = p_store_id
        and deleted_at is null
      for update;

      if not found then
        raise exception 'new_product_not_found';
      end if;

      select *
      into v_old_product
      from public.products
      where id = v_sale.product_id
        and store_id = p_store_id
        and deleted_at is null
      for update;

      if not found then
        raise exception 'old_product_not_found';
      end if;
    end if;
  end if;

  if v_same_product then
    update public.products
    set stock = coalesce(stock, 0) - (p_quantity - coalesce(v_sale.quantity, 0))
    where id = v_old_product.id
    returning *
    into v_old_updated;

    v_reference_price := coalesce(v_old_product.price, 0);
  else
    update public.products
    set stock = coalesce(stock, 0) + coalesce(v_sale.quantity, 0)
    where id = v_old_product.id
    returning *
    into v_old_updated;

    update public.products
    set stock = coalesce(stock, 0) - p_quantity
    where id = v_new_product.id
    returning *
    into v_new_updated;

    v_reference_price := coalesce(v_new_product.price, 0);
  end if;

  v_salesperson := nullif(trim(coalesce(p_salesperson, '')), '');
  if v_salesperson is null then
    v_salesperson := coalesce(nullif(trim(v_sale.salesperson), ''), '系统默认');
  end if;

  v_sale_date := coalesce(p_sale_date, v_sale.date, now());
  v_total_amount := round(
    coalesce(
      case when p_total_amount is not null and p_total_amount > 0 then p_total_amount end,
      v_reference_price * p_quantity
    )::numeric,
    2
  );

  update public.sales
  set product_id = p_product_id,
      quantity = p_quantity,
      total_amount = v_total_amount,
      salesperson = v_salesperson,
      date = v_sale_date
  where id = v_sale.id
  returning *
  into v_sale;

  return jsonb_build_object(
    'sale',
    jsonb_build_object(
      'id', v_sale.id,
      'productId', v_sale.product_id,
      'productName', case when v_same_product then v_old_updated.name else v_new_updated.name end,
      'quantity', v_sale.quantity,
      'totalAmount', v_sale.total_amount,
      'salesperson', v_sale.salesperson,
      'date', v_sale.date
    ),
    'oldProduct',
    to_jsonb(v_old_updated),
    'newProduct',
    case
      when v_same_product then null
      else to_jsonb(v_new_updated)
    end
  );
end;
$$;

revoke all on function public.create_sale_with_stock(uuid, uuid, integer, text, timestamptz, numeric) from public;
revoke all on function public.soft_delete_sale_with_stock(uuid, uuid) from public;
revoke all on function public.update_sale_with_stock(uuid, uuid, uuid, integer, numeric, text, timestamptz) from public;

grant execute on function public.create_sale_with_stock(uuid, uuid, integer, text, timestamptz, numeric) to authenticated;
grant execute on function public.create_sale_with_stock(uuid, uuid, integer, text, timestamptz, numeric) to service_role;
grant execute on function public.soft_delete_sale_with_stock(uuid, uuid) to authenticated;
grant execute on function public.soft_delete_sale_with_stock(uuid, uuid) to service_role;
grant execute on function public.update_sale_with_stock(uuid, uuid, uuid, integer, numeric, text, timestamptz) to authenticated;
grant execute on function public.update_sale_with_stock(uuid, uuid, uuid, integer, numeric, text, timestamptz) to service_role;

notify pgrst, 'reload schema';

commit;
