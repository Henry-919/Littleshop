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
      console.warn('Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      setLoading(false);
      return;
    }

    try {
      const { data: catData } = await supabase.from('categories').select('*');
      if (catData) setCategories(catData);

      const { data: prodData } = await supabase.from('products').select('*');
      if (prodData) setProducts(prodData);

      const { data: saleData } = await supabase.from('sales').select('*');
      if (saleData) setSales(saleData);
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
    if (!supabase) {
      alert('Supabase is not configured. Please check your environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).');
      return false;
    }
    const { data, error } = await supabase.from('categories').insert([{ name }]).select().single();
    if (error) {
      console.error('Error adding category:', error);
      alert(`Error adding category: ${error.message}`);
      return false;
    }
    setCategories(prev => [...prev, data]);
    return true;
  };

  const deleteCategory = async (id: string) => {
    if (!supabase) {
      alert('Supabase is not configured.');
      return false;
    }
    const hasProducts = products.some(p => p.category_id === id);
    if (hasProducts) {
      alert('Cannot delete category: There are active products associated with it.');
      return false;
    }

    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) {
      console.error('Error deleting category:', error);
      alert(`Error deleting category: ${error.message}`);
      return false;
    }
    setCategories(prev => prev.filter(c => c.id !== id));
    return true;
  };

  const addProduct = async (product: Omit<Product, 'id'>) => {
    if (!supabase) {
      alert('Supabase is not configured.');
      return false;
    }
    const { data, error } = await supabase.from('products').insert([product]).select().single();
    if (error) {
      console.error('Error adding product:', error);
      alert(`Error adding product: ${error.message}`);
      return false;
    }
    setProducts(prev => [...prev, data]);
    return true;
  };

  const deleteProduct = async (id: string) => {
    if (!supabase) {
      alert('Supabase is not configured.');
      return false;
    }
    // Hard delete
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) {
      console.error('Error deleting product:', error);
      alert(`Error deleting product: ${error.message}`);
      return false;
    }
    setProducts(prev => prev.filter(p => p.id !== id));
    return true;
  };

  const addSale = async (productId: string, quantity: number, salesperson: string, date?: string) => {
    if (!supabase) return false;
    const product = products.find(p => p.id === productId);
    if (!product || product.stock < quantity) return false;

    const newStock = product.stock - quantity;
    const totalAmount = product.price * quantity;
    const saleDate = date || new Date().toISOString();

    // Update stock
    const { error: stockError } = await supabase.from('products').update({ stock: newStock }).eq('id', productId);
    if (stockError) return false;

    // Insert sale
    const { data: saleData, error: saleError } = await supabase.from('sales').insert([{
      product_id: productId, // assuming column is product_id in DB
      quantity,
      total_amount: totalAmount, // assuming column is total_amount in DB
      salesperson,
      date: saleDate
    }]).select().single();

    if (saleError) return false;

    setProducts(prev => prev.map(p => p.id === productId ? { ...p, stock: newStock } : p));
    
    // Map DB columns back to local state format
    const newSale: Sale = {
      id: saleData.id,
      productId: saleData.product_id,
      quantity: saleData.quantity,
      totalAmount: saleData.total_amount,
      salesperson: saleData.salesperson,
      date: saleData.date
    };
    setSales(prev => [newSale, ...prev]);
    return true;
  };

  const processReceiptSales = async (
    items: { productId: string; productName: string; price: number; quantity: number; totalAmount: number }[],
    salesperson: string,
    date: string
  ) => {
    if (!supabase) return items.map(i => i.productName);
    
    let failedItems: string[] = [];
    
    for (const item of items) {
      let pid = item.productId;
      
      if (pid === 'CREATE_NEW') {
        const { data: newProd, error: prodError } = await supabase.from('products').insert([{
          name: `[新商品待分类] ${item.productName}`,
          price: item.price,
          cost_price: 0,
          stock: 0
        }]).select().single();
        
        if (prodError || !newProd) {
          failedItems.push(item.productName);
          continue;
        }
        pid = newProd.id;
        setProducts(prev => [...prev, newProd]);
      }

      const product = products.find(p => p.id === pid) || (pid !== 'CREATE_NEW' ? null : undefined);
      
      const isNew = product?.name.startsWith('[新商品待分类]') || pid === 'CREATE_NEW';
      if (!isNew && product && product.stock < item.quantity) {
        failedItems.push(item.productName);
        continue;
      }

      const currentStock = product ? product.stock : 0;
      const newStock = currentStock - item.quantity;

      await supabase.from('products').update({ stock: newStock }).eq('id', pid);
      
      const { data: saleData } = await supabase.from('sales').insert([{
        product_id: pid,
        quantity: item.quantity,
        total_amount: item.totalAmount,
        salesperson,
        date
      }]).select().single();

      if (saleData) {
        setProducts(prev => prev.map(p => p.id === pid ? { ...p, stock: newStock } : p));
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
    if (!supabase) throw new Error("Supabase not connected");
    
    let currentCats = [...categories];
    let currentProds = [...products];
    let successCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = row['商品名称'];
      const catName = row['类目'];
      const price = parseFloat(row['销售价'] || '0');
      const cost = parseFloat(row['成本价'] || '0');
      const stock = parseInt(row['库存数量'] || '0', 10);

      if (!name) continue;
      onProgress(`Processing ${i + 1}/${rows.length}: ${name}`);

      // Handle Category
      let catId = null;
      if (catName) {
        let cat = currentCats.find(c => c.name === catName);
        if (!cat) {
          const { data, error } = await supabase.from('categories').insert([{ name: catName }]).select().single();
          if (data && !error) {
            cat = data;
            currentCats.push(cat);
          }
        }
        catId = cat?.id || null;
      }

      // Handle Product
      let prod = currentProds.find(p => p.name === name);
      if (prod) {
        // Upsert: Add stock, update prices
        const newStock = prod.stock + stock;
        const { data, error } = await supabase.from('products')
          .update({ stock: newStock, price, cost_price: cost, category_id: catId })
          .eq('id', prod.id).select().single();
          
        if (data && !error) {
          currentProds = currentProds.map(p => p.id === prod.id ? data : p);
          successCount++;
        }
      } else {
        // Insert new
        const { data, error } = await supabase.from('products')
          .insert([{ name, price, cost_price: cost, stock, category_id: catId }])
          .select().single();
          
        if (data && !error) {
          currentProds.push(data);
          successCount++;
        }
      }
    }
    
    setCategories(currentCats);
    setProducts(currentProds);
    return successCount;
  };

  return { 
    products, 
    sales, 
    categories,
    loading,
    fetchData,
    addSale, 
    processReceiptSales,
    addCategory,
    deleteCategory,
    addProduct,
    deleteProduct,
    processExcelImport
  };
}
