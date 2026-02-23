import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface Category {
  id: string;
  name: string;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  category_id?: string;
  cost_price?: number;
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
    if (!supabase) {
      setLoading(false);
      return;
    }

    try {
      const [catRes, prodRes, saleRes] = await Promise.all([
        supabase.from('categories').select('*'),
        supabase.from('products').select('*').order('name'),
        supabase.from('sales').select('*').order('date', { ascending: false })
      ]);

      if (catRes.data) setCategories(catRes.data);
      if (prodRes.data) setProducts(prodRes.data);
      if (saleRes.data) {
        const mappedSales: Sale[] = saleRes.data.map(s => ({
          id: s.id,
          productId: s.product_id,
          quantity: s.quantity,
          totalAmount: s.total_amount, 
          salesperson: s.salesperson,
          date: s.date
        }));
        setSales(mappedSales);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // --- 商品管理逻辑 ---

  // 🚀 更新：现在返回创建成功的对象，方便 POS 拿到新 ID
  const addProduct = async (product: Omit<Product, 'id'>) => {
    const { data, error } = await supabase.from('products').insert([product]).select().single();
    if (error) {
      console.error('Add product error:', error);
      return { data: null, error };
    }
    setProducts(prev => [...prev, data]);
    return { data, error: null };
  };

  // 🚀 新增：手动更新商品数据（用于 Inventory 行内编辑）
  const updateProduct = async (id: string, updates: Partial<Product>) => {
    const { data, error } = await supabase
      .from('products')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Update product error:', error);
      return false;
    }

    setProducts(prev => prev.map(p => p.id === id ? data : p));
    return true;
  };

  const deleteProduct = async (id: string) => {
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) return false;
    setProducts(prev => prev.filter(p => p.id !== id));
    return true;
  };

  // --- 分类管理逻辑 ---

  const addCategory = async (name: string) => {
    const { data, error } = await supabase.from('categories').insert([{ name }]).select().single();
    if (error) return false;
    setCategories(prev => [...prev, data]);
    return true;
  };

  const deleteCategory = async (id: string) => {
    const hasProducts = products.some(p => p.category_id === id);
    if (hasProducts) {
      alert('无法删除：该分类下仍有商品');
      return false;
    }
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) return false;
    setCategories(prev => prev.filter(c => c.id !== id));
    return true;
  };

  // --- 销售管理逻辑 ---

  const addSale = async (productId: string, quantity: number | string, salesperson: string, date?: string) => {
    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) return false;

    const product = products.find(p => p.id === productId);
    if (!product) return false;

    const newStock = product.stock - qty;
    const totalAmount = product.price * qty;
    const saleDate = date || new Date().toISOString();

    try {
      // 更新库存
      const { error: updateError } = await supabase.from('products').update({ stock: newStock }).eq('id', productId);
      if (updateError) throw updateError;
      
      // 插入销售记录
      const { data: saleData, error: saleError } = await supabase.from('sales').insert([{
        product_id: productId,
        quantity: qty,
        total_amount: totalAmount,
        salesperson,
        date: saleDate
      }]).select().single();

      if (saleError) throw saleError;

      // 同步本地状态
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
    } catch (err) {
      console.error("Sale error:", err);
      return false;
    }
  };

  const deleteSale = async (id: string, productId: string, quantity: number) => {
    const { error: saleError } = await supabase.from('sales').delete().eq('id', id);
    if (saleError) return false;

    const product = products.find(p => p.id === productId);
    if (product) {
      const newStock = product.stock + quantity;
      await supabase.from('products').update({ stock: newStock }).eq('id', productId);
      setProducts(prev => prev.map(p => p.id === productId ? { ...p, stock: newStock } : p));
    }

    setSales(prev => prev.filter(s => s.id !== id));
    return true;
  };

  // --- 批量导入逻辑 ---

  const processExcelImport = async (rows: any[], onProgress: (msg: string) => void) => {
    let currentCats = [...categories];
    let currentProds = [...products];
    let successCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = row['商品名称'];
      if (!name) continue;

      const catName = row['类目'];
      const price = parseFloat(row['销售价'] || '0');
      const cost = parseFloat(row['成本价'] || '0');
      const stock = parseInt(row['库存数量'] || '0', 10);
      onProgress(`正在处理 ${i + 1}/${rows.length}: ${name}`);

      let catId = null;
      if (catName) {
        let cat = currentCats.find(c => c.name === catName);
        if (!cat) {
          const { data } = await supabase.from('categories').insert([{ name: catName }]).select().single();
          if (data) { cat = data; currentCats.push(cat); }
        }
        catId = cat?.id || null;
      }

      let prod = currentProds.find(p => p.name === name);
      if (prod) {
        const newStock = prod.stock + stock;
        const { data } = await supabase.from('products')
          .update({ stock: newStock, price, cost_price: cost, category_id: catId })
          .eq('id', prod.id).select().single();
        if (data) currentProds = currentProds.map(p => p.id === prod.id ? data : p);
      } else {
        const { data } = await supabase.from('products')
          .insert([{ name, price, cost_price: cost, stock, category_id: catId }]).select().single();
        if (data) currentProds.push(data);
      }
      successCount++;
    }
    
    setCategories(currentCats);
    setProducts(currentProds);
    return successCount;
  };

  return { 
    products, setProducts, sales, categories, loading, fetchData,
    addSale, addCategory, deleteCategory,
    addProduct, updateProduct, deleteProduct, deleteSale, processExcelImport 
  };
}