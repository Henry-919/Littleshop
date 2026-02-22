import { createClient } from '@supabase/supabase-js';
import { useState, useEffect } from 'react';

// 1. 初始化 Supabase 客户端
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;
export const supabase = createClient(supabaseUrl, supabaseKey);

export const useStore = () => {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);

  // --- 初始化加载数据 ---
  const fetchData = async () => {
    setLoading(true);
    const { data: p } = await supabase.from('products').select('*').order('name');
    const { data: c } = await supabase.from('categories').select('*').order('name');
    const { data: s } = await supabase.from('sales').select('*, products(name)').order('created_at', { ascending: false });
    
    setProducts(p || []);
    setCategories(c || []);
    setSales(s || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  // --- 商品管理 ---
  const addProduct = async (product) => {
    const { error } = await supabase.from('products').upsert(product);
    if (!error) fetchData();
    return error;
  };

  const deleteProduct = async (id) => {
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (!error) fetchData();
    return error;
  };

  // --- 销售记录与库存回滚 ---
  const addSale = async (productId, quantity, total) => {
    // 1. 插入销售记录
    const { error: saleError } = await supabase.from('sales').insert([
      { product_id: productId, quantity, total_amount: total }
    ]);
    if (saleError) return saleError;

    // 2. 更新库存 (减少)
    const product = products.find(p => p.id === productId);
    const { error: stockError } = await supabase.from('products')
      .update({ stock: (product.stock || 0) - quantity })
      .eq('id', productId);
    
    fetchData();
    return stockError;
  };

  const deleteSale = async (saleId, productId, quantity) => {
    // 1. 删除销售记录
    const { error: delError } = await supabase.from('sales').delete().eq('id', saleId);
    if (delError) return delError;

    // 2. 回滚库存 (增加)
    const product = products.find(p => p.id === productId);
    const { error: stockError } = await supabase.from('products')
      .update({ stock: (product.stock || 0) + quantity })
      .eq('id', productId);

    fetchData();
    return stockError;
  };

  return {
    products,
    categories,
    sales,
    loading,
    addProduct,
    deleteProduct,
    addSale,
    deleteSale,
    fetchData
  };
};