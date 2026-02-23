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
  totalAmount: number; // 本地 UI 逻辑保持叫 totalAmount
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
        supabase.from('products').select('*'),
        supabase.from('sales').select('*').order('date', { ascending: false })
      ]);

      if (catRes.data) setCategories(catRes.data);
      if (prodRes.data) setProducts(prodRes.data);
      if (saleRes.data) {
        // 映射数据库字段 total_price 到本地 Sale 接口
        const mappedSales: Sale[] = saleRes.data.map(s => ({
          id: s.id,
          productId: s.product_id,
          quantity: s.quantity,
          totalAmount: s.total_price, 
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

  const addProduct = async (product: Omit<Product, 'id'>) => {
    const { data, error } = await supabase.from('products').insert([product]).select().single();
    if (error) return false;
    setProducts(prev => [...prev, data]);
    return true;
  };

  const deleteProduct = async (id: string) => {
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) return false;
    setProducts(prev => prev.filter(p => p.id !== id));
    return true;
  };

  // 单次销售逻辑
  const addSale = async (productId: string, quantity: number, salesperson: string, date?: string) => {
    const product = products.find(p => p.id === productId);
    if (!product || product.stock < quantity) return false;

    const newStock = product.stock - quantity;
    const totalAmount = product.price * quantity;
    const saleDate = date || new Date().toISOString();

    try {
      // 1. 更新库存
      await supabase.from('products').update({ stock: newStock }).eq('id', productId);
      
      // 2. 插入销售记录 (使用 total_price)
      const { data: saleData, error: saleError } = await supabase.from('sales').insert([{
        product_id: productId,
        quantity,
        total_price: totalAmount,
        salesperson,
        date: saleDate
      }]).select().single();

      if (saleError) throw saleError;

      // 3. 同步状态
      setProducts(prev => prev.map(p => p.id === productId ? { ...p, stock: newStock } : p));
      setSales(prev => [{
        id: saleData.id,
        productId: saleData.product_id,
        quantity: saleData.quantity,
        totalAmount: saleData.total_price,
        salesperson: saleData.salesperson,
        date: saleData.date
      }, ...prev]);

      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  };

  // 发票批量扫描逻辑
  const processReceiptSales = async (
    items: { productId: string; productName: string; price: number; quantity: number; totalAmount: number }[],
    salesperson: string,
    date: string
  ) => {
    let failedItems: string[] = [];
    let currentLocalProducts = [...products];

    for (const item of items) {
      let pid = item.productId;

      // 处理新商品创建
      if (pid === 'CREATE_NEW') {
        const { data: newProd, error } = await supabase.from('products').insert([{
          name: `[新商品待分类] ${item.productName}`,
          price: item.price,
          stock: 0
        }]).select().single();
        if (error) { failedItems.push(item.productName); continue; }
        pid = newProd.id;
        currentLocalProducts.push(newProd);
      }

      const productIndex = currentLocalProducts.findIndex(p => p.id === pid);
      const product = currentLocalProducts[productIndex];
      if (!product) { failedItems.push(item.productName); continue; }

      const newStock = product.stock - item.quantity;

      // 执行数据库操作
      const { error: sErr } = await supabase.from('products').update({ stock: newStock }).eq('id', pid);
      const { data: saleData, error: saleErr } = await supabase.from('sales').insert([{
        product_id: pid,
        quantity: item.quantity,
        total_price: item.totalAmount,
        salesperson,
        date
      }]).select().single();

      if (sErr || saleErr) {
        failedItems.push(item.productName);
        continue;
      }

      // 更新副本并同步
      currentLocalProducts[productIndex] = { ...product, stock: newStock };
      setProducts([...currentLocalProducts]);
      if (saleData) {
        setSales(prev => [{
          id: saleData.id,
          productId: saleData.product_id,
          quantity: saleData.quantity,
          totalAmount: saleData.total_price,
          salesperson: saleData.salesperson,
          date: saleData.date
        }, ...prev]);
      }
    }
    return failedItems;
  };

  // Excel 导入逻辑 (支持累加库存)
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
      const stock = parseInt(row['库存数量'] || '0', 10);
      onProgress(`正在处理 ${i + 1}/${rows.length}: ${name}`);

      // 处理分类
      let catId = null;
      if (catName) {
        let cat = currentCats.find(c => c.name === catName);
        if (!cat) {
          const { data } = await supabase.from('categories').insert([{ name: catName }]).select().single();
          if (data) { cat = data; currentCats.push(cat); }
        }
        catId = cat?.id || null;
      }

      // 处理商品累加逻辑
      let prod = currentProds.find(p => p.name === name);
      if (prod) {
        const newStock = prod.stock + stock;
        const { data } = await supabase.from('products')
          .update({ stock: newStock, price, category_id: catId })
          .eq('id', prod.id).select().single();
        if (data) currentProds = currentProds.map(p => p.id === prod.id ? data : p);
      } else {
        const { data } = await supabase.from('products')
          .insert([{ name, price, stock, category_id: catId }]).select().single();
        if (data) currentProds.push(data);
      }
      successCount++;
    }
    
    setCategories(currentCats);
    setProducts(currentProds);
    return successCount;
  };

  return { 
    products, sales, categories, loading, fetchData,
    addSale, processReceiptSales, addCategory, deleteCategory,
    addProduct, deleteProduct, processExcelImport 
  };
}