import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface Category { id: string; name: string; }
export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  category_id?: string;
  cost_price?: number;
  time?: string;
}
export interface Sale {
  id: string;
  productId: string;
  quantity: number;
  totalAmount: number;
  salesperson: string;
  date: string;
}

export function useStore() {
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      const [catRes, prodRes, saleRes] = await Promise.all([
        supabase.from('categories').select('*'),
        supabase.from('products').select('*').order('name'),
        supabase.from('sales').select('*').order('date', { ascending: false })
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

  useEffect(() => { fetchData(); }, []);

  // --- 核心操作 ---

  const addProduct = async (product: Omit<Product, 'id'>) => {
    const { data, error } = await supabase.from('products').insert([{
      ...product,
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
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (!error) setProducts(prev => prev.filter(p => p.id !== id));
    return !error;
  };

  const addSale = async (productId: string, quantity: number, salesperson: string, date?: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return false;

    const newStock = product.stock - quantity;
    const saleDate = date || new Date().toISOString();

    const { data: saleData, error: saleError } = await supabase.from('sales').insert([{
      product_id: productId,
      quantity,
      total_amount: product.price * quantity,
      salesperson,
      date: saleDate
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
    const { data, error } = await supabase.from('categories').insert([{ name }]).select().single();
    if (!error && data) setCategories(prev => [...prev, data]);
    return !error;
  };

  const deleteCategory = async (id: string) => {
    // 1. 将属于该分类的商品 category_id 设为 null
    await supabase.from('products').update({ category_id: null }).eq('category_id', id);
    // 2. 删除分类
    const { error } = await supabase.from('categories').delete().eq('id', id);
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

    const { error } = await supabase.from('sales').delete().eq('id', id);
    if (!error) setSales(prev => prev.filter(s => s.id !== id));
    return !error;
  };

  const processExcelImport = async (rows: any[], onProgress: (msg: string) => void) => {
    let successCount = 0;
    for (const row of rows) {
      const name = row['商品名称'];
      if (!name) continue;
      onProgress(`处理中: ${name}`);

      const price = parseFloat(row['销售价'] || '0');
      const stock = parseInt(row['库存数量'] || '0', 10);

      // 修改逻辑：如果存在则覆盖库存数量
      const existing = products.find(p => p.name === name);
      if (existing) {
        await updateProduct(existing.id, { stock, price });
      } else {
        await addProduct({ name, price, stock, cost_price: parseFloat(row['成本价'] || '0') });
      }
      successCount++;
    }
    await fetchData(); // 批量处理完刷新一次
    return successCount;
  };

  return { 
    products, sales, categories, loading, fetchData,
    addProduct, updateProduct, deleteProduct, addSale, processExcelImport,
    addCategory, deleteCategory, deleteSale
  };
}