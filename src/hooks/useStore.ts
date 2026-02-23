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
        supabase.from('products').select('*'),
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

  // 🚀 更新 1：更健壮的单次销售逻辑
  const addSale = async (productId: string, quantity: number | string, salesperson: string, date?: string) => {
    // 强制转为数字，防止从 UI 传过来的 input 字符串引发 NaN 错误
    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      console.error("售卖失败：数量无效", quantity);
      return false;
    }

    const product = products.find(p => p.id === productId);
    
    // 增加控制台打印，方便调试“点选无反应”
    if (!product) {
      console.error("售卖失败：找不到对应商品ID", productId);
      return false;
    } 
    if (product.stock < qty) {
      console.warn(`售卖失败：库存不足！当前库存: ${product.stock}, 尝试售出: ${qty}`);
      return false;
    }

    const newStock = product.stock - qty;
    const totalAmount = product.price * qty;
    const saleDate = date || new Date().toISOString();

    try {
      const { error: updateError } = await supabase.from('products').update({ stock: newStock }).eq('id', productId);
      if (updateError) throw updateError;
      
      const { data: saleData, error: saleError } = await supabase.from('sales').insert([{
        product_id: productId,
        quantity: qty,
        total_amount: totalAmount,
        salesperson,
        date: saleDate
      }]).select().single();

      if (saleError) throw saleError;

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
      console.error("交易写入失败:", err);
      return false;
    }
  };

  // 🚀 更新 2：发票扫描支持传递 categoryId，且去除了丑陋的前缀
  const processReceiptSales = async (
    // 新增了可选的 categoryId 属性
    items: { productId: string; productName: string; price: number; quantity: number; totalAmount: number; categoryId?: string }[],
    salesperson: string,
    date: string
  ) => {
    let failedItems: string[] = [];
    let currentLocalProducts = [...products];

    for (const item of items) {
      let pid = item.productId;
      const qty = Number(item.quantity);

      if (pid === 'CREATE_NEW') {
        const { data: newProd, error } = await supabase.from('products').insert([{
          name: item.productName, // 去掉前缀，因为可以设置分类了
          price: item.price,
          cost_price: 0,
          stock: 0,
          category_id: item.categoryId || null // 👈 支持存入分类
        }]).select().single();
        
        if (error) { 
          console.error("创建新商品失败:", error);
          failedItems.push(item.productName); 
          continue; 
        }
        pid = newProd.id;
        currentLocalProducts.push(newProd);
      }

      const productIndex = currentLocalProducts.findIndex(p => p.id === pid);
      const product = currentLocalProducts[productIndex];
      if (!product) { failedItems.push(item.productName); continue; }

      const newStock = product.stock - qty;

      const { error: sErr } = await supabase.from('products').update({ stock: newStock }).eq('id', pid);
      const { data: saleData, error: saleErr } = await supabase.from('sales').insert([{
        product_id: pid,
        quantity: qty,
        total_amount: item.totalAmount,
        salesperson,
        date
      }]).select().single();

      if (sErr || saleErr) {
        console.error("更新库存或写入记录失败:", sErr || saleErr);
        failedItems.push(item.productName);
        continue;
      }

      currentLocalProducts[productIndex] = { ...product, stock: newStock };
      setProducts([...currentLocalProducts]);
      if (saleData) {
        setSales(prev => [{
          id: saleData.id,
          productId: saleData.product_id,
          quantity: saleData.quantity,
          totalAmount: saleData.total_amount,
          salesperson: saleData.salesperson,
          date: saleData.date
        }, ...prev]);
      }
    }
    return failedItems;
  };

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
    products, sales, categories, loading, fetchData,
    addSale, processReceiptSales, addCategory, deleteCategory,
    addProduct, deleteProduct, deleteSale, processExcelImport 
  };
}