import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

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

  const addProduct = async (product: Omit<Product, 'id'>) => {
    if (!storeId) return { data: null, error: new Error('store_id is required') as any };
    const { data, error } = await supabase.from('products').insert([{
      ...product,
      store_id: storeId,
      time: product.time || new Date().toISOString(),
      stock: product.stock || 10 // Default stock to 10 if not provided
    }]).select().single();
    if (!error && data) setProducts(prev => [...prev, data]);
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

  const addSale = async (productId: string, quantity: number, salesperson: string, date?: string) => {
    if (!storeId) return false;
    const product = products.find(p => p.id === productId);
    if (!product) return false;

    const newStock = product.stock - quantity;
    const saleDate = date || new Date().toISOString();

    const { data: saleData, error: saleError } = await supabase.from('sales').insert([{
      product_id: productId,
      quantity,
      total_amount: product.price * quantity,
      salesperson,
      date: saleDate,
      store_id: storeId
    }]).select().single();

    if (!saleError && saleData) {
      await supabase.from('products').update({ stock: newStock }).eq('id', productId);
      setProducts(prev => prev.map(p => p.id === productId ? { ...p, stock: newStock } : p));
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

  const processExcelImport = async (rows: any[], onProgress: (msg: string) => void) => {
    let successCount = 0;
    
    // 预先获取最新的分类列表，避免在循环中频繁查询
    let currentCategories = [...categories];
    // 批次内商品缓存：避免同一份 Excel 里重复商品名导致重复插入
    let currentProducts = [...products];

    const normalize = (value: string) => value.trim().toLowerCase();

    for (const row of rows) {
      const name = String(row['商品名称'] || '').trim();
      if (!name) continue;
      onProgress(`处理中: ${name}`);

      const price = parseFloat(row['销售价'] || '0');
      const stock = parseInt(row['库存数量'] || '0', 10);
      const cost_price = parseFloat(row['成本价'] || '0');
      const categoryName = String(row['类目'] || '').trim();

      let category_id = undefined;

      // 处理分类
      if (categoryName) {
        const existingCategory = currentCategories.find(c => normalize(c.name) === normalize(categoryName));
        if (existingCategory) {
          category_id = existingCategory.id;
        } else if (storeId) {
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
          }
        }
      }

      // 修改逻辑：如果存在则覆盖库存数量
      const existing = currentProducts.find(p => normalize(p.name) === normalize(name));
      if (existing) {
        const updated = await updateProduct(existing.id, { stock, price, cost_price, category_id });
        if (updated) {
          currentProducts = currentProducts.map(p => p.id === existing.id ? { ...p, stock, price, cost_price, category_id } : p);
        }
      } else {
        const { data, error } = await addProduct({ name, price, stock, cost_price, category_id });

        if (!error && data) {
          currentProducts.push(data);
        } else if ((error as any)?.code === '23505') {
          // 唯一键冲突时回退为更新（并发或历史数据大小写差异）
          const { data: duplicated } = await supabase
            .from('products')
            .select('id')
            .eq('store_id', storeId)
            .eq('name', name)
            .is('deleted_at', null)
            .maybeSingle();

          if (duplicated?.id) {
            await updateProduct(duplicated.id, { stock, price, cost_price, category_id });
            currentProducts = currentProducts.map(p => p.id === duplicated.id ? { ...p, stock, price, cost_price, category_id } : p);
          }
        }
      }
      successCount++;
    }
    await fetchData(); // 批量处理完刷新一次
    return successCount;
  };

  return { 
    products, sales, categories, loading, fetchData,
    addProduct, updateProduct, deleteProduct, addSale, processExcelImport,
    addCategory, updateCategory, deleteCategory, deleteSale
  };
}