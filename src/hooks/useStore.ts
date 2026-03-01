import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { appendInboundLogs } from '../lib/inboundLog';

export interface Category { id: string; name: string; low_stock_threshold?: number | null; store_id?: string; deleted_at?: string | null; }
export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  category_id?: string;
  cost_price?: number;
  time?: string;
  store_id?: string;
  deleted_at?: string | null;
}
export interface Sale {
  id: string;
  productId: string;
  quantity: number;
  totalAmount: number;
  salesperson: string;
  date: string;
  store_id?: string;
  deleted_at?: string | null;
}

export function useStore(storeId?: string) {
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!supabase) return;
    if (!storeId) {
      setProducts([]);
      setSales([]);
      setCategories([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [catRes, prodRes, saleRes] = await Promise.all([
        supabase.from('categories').select('*').eq('store_id', storeId).is('deleted_at', null),
        supabase.from('products').select('*').eq('store_id', storeId).is('deleted_at', null).order('name'),
        supabase.from('sales').select('*').eq('store_id', storeId).is('deleted_at', null).order('date', { ascending: false })
      ]);

      if (catRes.data) setCategories(catRes.data);
      if (prodRes.data) setProducts(prodRes.data);
      if (saleRes.data) {
        setSales(saleRes.data.map(s => ({
          id: s.id,
          productId: s.product_id,
          quantity: s.quantity,
          totalAmount: s.total_amount,
          salesperson: s.salesperson,
          date: s.date
        })));
      }
    } catch (error) {
      console.error('Fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [storeId]);

  // --- 核心操作 ---

  const normalizeSaleDate = (input?: string) => {
    const fallback = new Date().toISOString();
    if (!input) return fallback;

    const raw = String(input).trim();
    if (!raw) return fallback;

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return `${raw}T00:00:00.000Z`;
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return fallback;
    }
    return parsed.toISOString();
  };

  const addProduct = async (product: Omit<Product, 'id'>) => {
    if (!storeId) return { data: null, error: new Error('store_id is required') as any };
    const insertPayload = {
      ...product,
      store_id: storeId,
      time: product.time || new Date().toISOString(),
      stock: product.stock ?? 10
    };

    const { data, error } = await supabase.from('products').insert([insertPayload]).select().single();
    if (!error && data) setProducts(prev => [...prev, data]);

    if ((error as any)?.code === '23505' || (error as any)?.status === 409) {
      const { data: duplicatedList } = await supabase
        .from('products')
        .select('id,name')
        .eq('store_id', storeId)
        .ilike('name', product.name)
        .limit(1);

      const duplicated = duplicatedList && duplicatedList[0];
      if (duplicated?.id) {
        const { data: restored, error: restoreError } = await supabase
          .from('products')
          .update({
            ...product,
            deleted_at: null,
            time: product.time || new Date().toISOString(),
            stock: product.stock ?? 10
          })
          .eq('id', duplicated.id)
          .select()
          .single();

        if (!restoreError && restored) {
          setProducts(prev => {
            const existed = prev.some(p => p.id === restored.id);
            if (existed) return prev.map(p => p.id === restored.id ? restored : p);
            return [...prev, restored];
          });
          return { data: restored, error: null as any };
        }
      }
    }

    return { data, error };
  };

  const updateProduct = async (id: string, updates: Partial<Product>) => {
    const { data, error } = await supabase.from('products').update(updates).eq('id', id).select().single();
    if (!error && data) {
      setProducts(prev => prev.map(p => p.id === id ? data : p));
      return true;
    }
    return false;
  };

  const deleteProduct = async (id: string) => {
    const { error } = await supabase.from('products').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (!error) setProducts(prev => prev.filter(p => p.id !== id));
    return !error;
  };

  const addSale = async (productId: string, quantity: number, salesperson: string, date?: string, overrideTotalAmount?: number) => {
    if (!storeId) return false;
    let product = products.find(p => p.id === productId);

    if (!product) {
      const { data: dbProduct, error: dbProductError } = await supabase
        .from('products')
        .select('id,name,price,stock,cost_price,category_id,time,store_id,deleted_at')
        .eq('id', productId)
        .eq('store_id', storeId)
        .is('deleted_at', null)
        .single();

      if (dbProductError || !dbProduct) return false;

      product = {
        id: dbProduct.id,
        name: dbProduct.name,
        price: Number(dbProduct.price) || 0,
        stock: Number(dbProduct.stock) || 0,
        cost_price: dbProduct.cost_price,
        category_id: dbProduct.category_id,
        time: dbProduct.time,
        store_id: dbProduct.store_id,
        deleted_at: dbProduct.deleted_at
      };

      setProducts(prev => prev.some(p => p.id === productId) ? prev : [...prev, product as Product]);
    }

    const newStock = (Number(product.stock) || 0) - quantity;
    const saleDate = normalizeSaleDate(date);
    // 优先使用传入的实际售价（发票识别价格），否则用商品标价
    const finalTotalAmount = (overrideTotalAmount !== undefined && overrideTotalAmount > 0)
      ? overrideTotalAmount
      : (Number(product.price) || 0) * quantity;

    const { data: saleData, error: saleError } = await supabase.from('sales').insert([{
      product_id: productId,
      quantity,
      total_amount: finalTotalAmount,
      salesperson,
      date: saleDate,
      store_id: storeId
    }]).select().single();

    if (!saleError && saleData) {
      await supabase.from('products').update({ stock: newStock }).eq('id', productId);
      setProducts(prev => {
        const existed = prev.some(p => p.id === productId);
        if (existed) {
          return prev.map(p => p.id === productId ? { ...p, stock: newStock } : p);
        }
        return [...prev, { ...(product as Product), stock: newStock }];
      });
      setSales(prev => [{
        id: saleData.id,
        productId: saleData.product_id,
        quantity: saleData.quantity,
        totalAmount: saleData.total_amount,
        salesperson: saleData.salesperson,
        date: saleData.date
      }, ...prev]);
      return true;
    }
    return false;
  };

  const addCategory = async (name: string) => {
    if (!storeId) return false;
    const { data, error } = await supabase.from('categories').insert([{
      name,
      store_id: storeId
    }]).select().single();
    if (!error && data) setCategories(prev => [...prev, data]);
    return !error;
  };

  const updateCategory = async (id: string, updates: Partial<Category>) => {
    const { data, error } = await supabase.from('categories').update(updates).eq('id', id).select().single();
    if (!error && data) {
      setCategories(prev => prev.map(c => c.id === id ? data : c));
      return true;
    }
    return false;
  };

  const deleteCategory = async (id: string) => {
    // 1. 将属于该分类的商品 category_id 设为 null
    await supabase.from('products').update({ category_id: null }).eq('category_id', id).eq('store_id', storeId);
    // 2. 删除分类
    const { error } = await supabase.from('categories').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (!error) {
      setCategories(prev => prev.filter(c => c.id !== id));
      setProducts(prev => prev.map(p => p.category_id === id ? { ...p, category_id: undefined } : p));
    }
    return !error;
  };

  const deleteSale = async (id: string) => {
    const sale = sales.find(s => s.id === id);
    if (!sale) return false;

    // 恢复库存
    const product = products.find(p => p.id === sale.productId);
    if (product) {
      const newStock = product.stock + sale.quantity;
      await supabase.from('products').update({ stock: newStock }).eq('id', product.id);
      setProducts(prev => prev.map(p => p.id === product.id ? { ...p, stock: newStock } : p));
    }

    const { error } = await supabase.from('sales').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (!error) setSales(prev => prev.filter(s => s.id !== id));
    return !error;
  };

  const transferStock = async (productId: string, targetStoreId: string, quantity: number) => {
    if (!storeId) return { success: false, message: '请先选择源门店' };
    if (!targetStoreId) return { success: false, message: '请选择目标门店' };
    if (targetStoreId === storeId) return { success: false, message: '源门店和目标门店不能相同' };

    const transferQty = Number(quantity);
    if (!Number.isFinite(transferQty) || transferQty <= 0) {
      return { success: false, message: '调货数量必须大于 0' };
    }

    const { data: sourceProduct, error: sourceError } = await supabase
      .from('products')
      .select('id,name,price,stock,cost_price,category_id,time')
      .eq('id', productId)
      .eq('store_id', storeId)
      .is('deleted_at', null)
      .single();

    if (sourceError || !sourceProduct) {
      return { success: false, message: '未找到源商品' };
    }

    const sourceStock = Number(sourceProduct.stock) || 0;
    if (sourceStock < transferQty) {
      return { success: false, message: `库存不足，当前仅剩 ${sourceStock}` };
    }

    let targetCategoryId: string | undefined;
    if (sourceProduct.category_id) {
      const { data: sourceCategory } = await supabase
        .from('categories')
        .select('name')
        .eq('id', sourceProduct.category_id)
        .eq('store_id', storeId)
        .is('deleted_at', null)
        .single();

      const categoryName = sourceCategory?.name?.trim();
      if (categoryName) {
        const { data: targetCategoryList } = await supabase
          .from('categories')
          .select('id,name')
          .eq('store_id', targetStoreId)
          .ilike('name', categoryName)
          .is('deleted_at', null)
          .limit(1);

        if (targetCategoryList?.[0]?.id) {
          targetCategoryId = targetCategoryList[0].id;
        } else {
          const { data: createdCategory } = await supabase
            .from('categories')
            .insert([{ name: categoryName, store_id: targetStoreId }])
            .select('id')
            .single();

          if (createdCategory?.id) {
            targetCategoryId = createdCategory.id;
          }
        }
      }
    }

    const { data: targetProductList } = await supabase
      .from('products')
      .select('id,stock,name')
      .eq('store_id', targetStoreId)
      .ilike('name', sourceProduct.name)
      .is('deleted_at', null)
      .limit(1);

    const targetExisting = targetProductList?.[0];
    let insertedTargetId: string | null = null;
    let targetPrevStock = 0;

    if (targetExisting) {
      targetPrevStock = Number(targetExisting.stock) || 0;
      const { error: updateTargetError } = await supabase
        .from('products')
        .update({ stock: targetPrevStock + transferQty })
        .eq('id', targetExisting.id);

      if (updateTargetError) {
        return { success: false, message: '目标门店入库失败' };
      }
    } else {
      const { data: insertedTarget, error: insertTargetError } = await supabase
        .from('products')
        .insert([{
          name: sourceProduct.name,
          price: Number(sourceProduct.price) || Number(sourceProduct.cost_price) || 0,
          stock: transferQty,
          cost_price: Number(sourceProduct.cost_price) || 0,
          category_id: targetCategoryId,
          time: new Date().toISOString(),
          store_id: targetStoreId
        }])
        .select('id')
        .single();

      if (insertTargetError || !insertedTarget) {
        return { success: false, message: '目标门店创建商品失败' };
      }

      insertedTargetId = insertedTarget.id;
    }

    const newSourceStock = sourceStock - transferQty;
    const { error: updateSourceError } = await supabase
      .from('products')
      .update({ stock: newSourceStock })
      .eq('id', sourceProduct.id)
      .eq('store_id', storeId);

    if (updateSourceError) {
      if (targetExisting) {
        await supabase
          .from('products')
          .update({ stock: targetPrevStock })
          .eq('id', targetExisting.id);
      }
      if (insertedTargetId) {
        await supabase
          .from('products')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', insertedTargetId);
      }
      return { success: false, message: '源门店扣减失败，已回滚目标门店库存' };
    }

    const { error: transferLogError } = await supabase
      .from('stock_transfers')
      .insert([{
        product_name: sourceProduct.name,
        quantity: transferQty,
        source_store_id: storeId,
        target_store_id: targetStoreId,
        source_product_id: sourceProduct.id,
        target_product_id: targetExisting?.id || insertedTargetId,
        created_at: new Date().toISOString()
      }]);

    setProducts(prev => prev.map(p => p.id === sourceProduct.id ? { ...p, stock: newSourceStock } : p));

    if (transferLogError) {
      return { success: true, message: '调货成功，但调货记录写入失败' };
    }
    return { success: true, message: '调货成功' };
  };

  const updateSale = async (
    saleId: string,
    updates: { productId?: string; quantity?: number; totalAmount?: number; salesperson?: string; date?: string }
  ) => {
    const oldSale = sales.find(s => s.id === saleId);
    if (!oldSale) return false;

    const newProductId = updates.productId ?? oldSale.productId;
    const newQuantity = updates.quantity ?? oldSale.quantity;
    const newTotalAmount = updates.totalAmount ?? oldSale.totalAmount;
    const newSalesperson = updates.salesperson ?? oldSale.salesperson;
    const newDate = updates.date !== undefined ? normalizeSaleDate(updates.date) : oldSale.date;

    // 1. 库存调整：还原旧商品库存，扣减新商品库存
    const oldProduct = products.find(p => p.id === oldSale.productId);
    const isSameProduct = newProductId === oldSale.productId;

    if (isSameProduct && oldProduct) {
      // 同商品：只调整差量
      const qtyDiff = newQuantity - oldSale.quantity;
      if (qtyDiff !== 0) {
        const newStock = oldProduct.stock - qtyDiff;
        await supabase.from('products').update({ stock: newStock }).eq('id', oldProduct.id);
        setProducts(prev => prev.map(p => p.id === oldProduct.id ? { ...p, stock: newStock } : p));
      }
    } else {
      // 换商品：还原旧、扣减新
      if (oldProduct) {
        const restoredStock = oldProduct.stock + oldSale.quantity;
        await supabase.from('products').update({ stock: restoredStock }).eq('id', oldProduct.id);
        setProducts(prev => prev.map(p => p.id === oldProduct.id ? { ...p, stock: restoredStock } : p));
      }
      const newProduct = products.find(p => p.id === newProductId);
      if (newProduct) {
        const deductedStock = newProduct.stock - newQuantity;
        await supabase.from('products').update({ stock: deductedStock }).eq('id', newProduct.id);
        setProducts(prev => prev.map(p => p.id === newProduct.id ? { ...p, stock: deductedStock } : p));
      }
    }

    // 2. 更新销售记录
    const dbUpdates: any = {
      product_id: newProductId,
      quantity: newQuantity,
      total_amount: newTotalAmount,
      salesperson: newSalesperson,
      date: newDate
    };
    const { error } = await supabase.from('sales').update(dbUpdates).eq('id', saleId);
    if (error) return false;

    setSales(prev => prev.map(s => s.id === saleId ? {
      ...s,
      productId: newProductId,
      quantity: newQuantity,
      totalAmount: newTotalAmount,
      salesperson: newSalesperson,
      date: newDate
    } : s));
    return true;
  };

  const processExcelImport = async (
    rows: any[],
    onProgress: (msg: string) => void,
    mode: 'increment' | 'overwrite' = 'increment'
  ) => {
    if (!storeId) return 0;

    let successCount = 0;
    const inboundLogs: Array<{ storeId?: string; source: 'excel_import'; productName: string; qty: number; note?: string }> = [];
    const normalize = (value: string) => value.trim().toLowerCase();

    // 导入前从数据库拉取最新数据，避免前端状态滞后造成重复插入
    const [catRes, prodRes] = await Promise.all([
      supabase.from('categories').select('id,name').eq('store_id', storeId).is('deleted_at', null),
      supabase.from('products').select('id,name,stock').eq('store_id', storeId).is('deleted_at', null)
    ]);

    let currentCategories: Array<{ id: string; name: string }> = catRes.data || [];
    let currentProducts: Array<{ id: string; name: string; stock: number }> = prodRes.data || [];

    for (const row of rows) {
      const name = String(row['商品名称'] || '').trim();
      if (!name) continue;
      onProgress(`处理中: ${name}`);

      const rawStock = parseInt(row['库存数量'] || '0', 10);
      const rawCost = parseFloat(row['成本价'] || '0');
      const salesPriceText = String(row['销售价'] ?? '').trim();
      const salesPriceNumber = parseFloat(salesPriceText);
      const hasSalesPrice = salesPriceText !== '' && Number.isFinite(salesPriceNumber);
      const price = hasSalesPrice ? salesPriceNumber : null;
      const stock = Number.isFinite(rawStock) ? rawStock : 0;
      const cost_price = Number.isFinite(rawCost) ? rawCost : 0;
      const categoryName = String(row['类目'] || '').trim() || '未分类';

      let category_id = undefined;

      // 处理分类（类目为空时自动归入“未分类”）
      const existingCategory = currentCategories.find(c => normalize(c.name) === normalize(categoryName));
      if (existingCategory) {
        category_id = existingCategory.id;
      } else {
        // 如果分类不存在，则创建新分类
        const { data: newCategory, error } = await supabase
          .from('categories')
          .insert([{ name: categoryName, store_id: storeId }])
          .select()
          .single();
          
        if (!error && newCategory) {
          category_id = newCategory.id;
          currentCategories.push(newCategory); // 更新本地缓存
          setCategories(prev => [...prev, newCategory]); // 更新状态
        } else if ((error as any)?.code === '23505' || (error as any)?.status === 409) {
          // 冲突回退：可能是并发或大小写差异，按名称重新查找
          const { data: duplicatedCategory } = await supabase
            .from('categories')
            .select('id,name')
            .eq('store_id', storeId)
            .ilike('name', categoryName)
            .is('deleted_at', null)
            .limit(1);

          if (duplicatedCategory && duplicatedCategory[0]) {
            category_id = duplicatedCategory[0].id;
            if (!currentCategories.some(c => c.id === duplicatedCategory[0].id)) {
              currentCategories.push(duplicatedCategory[0]);
            }
          }
        }
      }

      // 修改逻辑：如果存在则覆盖库存数量
      const existing = currentProducts.find(p => normalize(p.name) === normalize(name));
      if (existing) {
        const currentStock = Number(existing.stock) || 0;
        const targetStock = mode === 'increment' ? (Number(existing.stock) || 0) + stock : stock;
        const updates: Partial<Product> = { stock: targetStock, cost_price, category_id };
        if (price !== null) {
          updates.price = price;
        }
        const updated = await updateProduct(existing.id, updates);
        if (updated) {
          const delta = targetStock - currentStock;
          if (delta > 0) {
            inboundLogs.push({
              storeId,
              source: 'excel_import',
              productName: name,
              qty: delta,
              note: mode === 'overwrite' ? 'Excel导入（覆盖后净增加）' : 'Excel导入（增量）'
            });
          }
          currentProducts = currentProducts.map(p => p.id === existing.id ? { ...p, stock: targetStock } : p);
        }
      } else {
        const finalPrice = price ?? cost_price;
        const { data, error } = await addProduct({ name, price: finalPrice, stock, cost_price, category_id });

        if (!error && data) {
          if (stock > 0) {
            inboundLogs.push({
              storeId,
              source: 'excel_import',
              productName: name,
              qty: stock,
              note: 'Excel导入（新建商品）'
            });
          }
          currentProducts.push(data);
        } else if ((error as any)?.code === '23505' || (error as any)?.status === 409) {
          // 唯一键冲突时回退为更新（并发或历史数据大小写差异）
          const { data: duplicatedList } = await supabase
            .from('products')
            .select('id,name')
            .eq('store_id', storeId)
            .ilike('name', name)
            .is('deleted_at', null)
            .limit(1);

          const duplicated = duplicatedList && duplicatedList[0];
          if (duplicated?.id) {
            const duplicatedCurrent = currentProducts.find(p => p.id === duplicated.id);
            const targetStock = mode === 'increment'
              ? (Number(duplicatedCurrent?.stock) || 0) + stock
              : stock;
            const previousStock = Number(duplicatedCurrent?.stock) || 0;

            const updates: Partial<Product> = { stock: targetStock, cost_price, category_id };
            if (price !== null) {
              updates.price = price;
            }
            const ok = await updateProduct(duplicated.id, updates);
            if (ok) {
              const delta = targetStock - previousStock;
              if (delta > 0) {
                inboundLogs.push({
                  storeId,
                  source: 'excel_import',
                  productName: name,
                  qty: delta,
                  note: mode === 'overwrite' ? 'Excel导入（覆盖后净增加）' : 'Excel导入（冲突回退更新）'
                });
              }
            }
            if (!currentProducts.some(p => p.id === duplicated.id)) {
              currentProducts.push({ ...duplicated, stock: targetStock });
            } else {
              currentProducts = currentProducts.map(p => p.id === duplicated.id ? { ...p, stock: targetStock } : p);
            }
          }
        }
      }
      successCount++;
    }
    appendInboundLogs(inboundLogs);
    await fetchData(); // 批量处理完刷新一次
    return successCount;
  };

  return { 
    products, sales, categories, loading, fetchData,
    addProduct, updateProduct, deleteProduct, addSale, processExcelImport,
    addCategory, updateCategory, deleteCategory, deleteSale, updateSale,
    transferStock
  };
}