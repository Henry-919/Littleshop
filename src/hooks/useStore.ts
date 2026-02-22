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

const INITIAL_PRODUCTS: Product[] = [
  { id: '1', name: 'Coca Cola', stock: 50, price: 1.5, cost_price: 0.5 },
  { id: '2', name: 'Lays Chips', stock: 30, price: 2.0, cost_price: 1.0 },
  { id: '3', name: 'Water Bottle', stock: 100, price: 1.0, cost_price: 0.2 },
  { id: '4', name: 'Chocolate Bar', stock: 4, price: 1.8, cost_price: 0.8 },
  { id: '5', name: 'Notebook', stock: 5, price: 3.5, cost_price: 1.5 },
];

export function useStore() {
  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem('shop_products');
    return saved ? JSON.parse(saved) : INITIAL_PRODUCTS;
  });

  const [sales, setSales] = useState<Sale[]>(() => {
    const saved = localStorage.getItem('shop_sales');
    return saved ? JSON.parse(saved) : [];
  });

  const [categories, setCategories] = useState<Category[]>(() => {
    const saved = localStorage.getItem('shop_categories');
    return saved ? JSON.parse(saved) : [];
  });

  // Fetch from Supabase if configured
  useEffect(() => {
    if (supabase) {
      const fetchData = async () => {
        const { data: catData } = await supabase.from('categories').select('*');
        if (catData) setCategories(catData);

        const { data: prodData } = await supabase.from('products').select('*');
        if (prodData) setProducts(prodData);
      };
      fetchData();
    }
  }, []);

  // Save to localStorage as fallback
  useEffect(() => {
    if (!supabase) {
      localStorage.setItem('shop_products', JSON.stringify(products));
      localStorage.setItem('shop_sales', JSON.stringify(sales));
      localStorage.setItem('shop_categories', JSON.stringify(categories));
    }
  }, [products, sales, categories]);

  const addCategory = async (name: string) => {
    const newCategory = { id: Date.now().toString(), name };
    if (supabase) {
      const { data, error } = await supabase.from('categories').insert([{ name }]).select().single();
      if (error) {
        console.error('Error adding category:', error);
        return false;
      }
      setCategories(prev => [...prev, data]);
      return true;
    }
    setCategories(prev => [...prev, newCategory]);
    return true;
  };

  const deleteCategory = async (id: string) => {
    const hasProducts = products.some(p => p.category_id === id);
    if (hasProducts) {
      alert('Cannot delete category: There are products associated with it.');
      return false;
    }

    if (supabase) {
      const { error } = await supabase.from('categories').delete().eq('id', id);
      if (error) {
        console.error('Error deleting category:', error);
        return false;
      }
    }
    setCategories(prev => prev.filter(c => c.id !== id));
    return true;
  };

  const addProduct = async (product: Omit<Product, 'id'>) => {
    const newProduct = { ...product, id: Date.now().toString() };
    if (supabase) {
      const { data, error } = await supabase.from('products').insert([product]).select().single();
      if (error) {
        console.error('Error adding product:', error);
        return false;
      }
      setProducts(prev => [...prev, data]);
      return true;
    }
    setProducts(prev => [...prev, newProduct]);
    return true;
  };

  const deleteProduct = async (id: string) => {
    if (supabase) {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) {
        console.error('Error deleting product:', error);
        return false;
      }
    }
    setProducts(prev => prev.filter(p => p.id !== id));
    return true;
  };

  const addSale = async (productId: string, quantity: number, salesperson: string, date?: string) => {
    const product = products.find(p => p.id === productId);
    if (!product || product.stock < quantity) return false;

    const newSale: Sale = {
      id: Date.now().toString() + Math.random().toString(36).substring(7),
      productId,
      quantity,
      totalAmount: product.price * quantity,
      salesperson,
      date: date || new Date().toISOString(),
    };

    if (supabase) {
      await supabase.from('products').update({ stock: product.stock - quantity }).eq('id', productId);
    }

    setProducts(prev => prev.map(p => 
      p.id === productId ? { ...p, stock: p.stock - quantity } : p
    ));
    setSales(prev => [newSale, ...prev]);
    return true;
  };

  const processReceiptSales = (
    items: { productId: string; productName: string; price: number; quantity: number; totalAmount: number }[],
    salesperson: string,
    date: string
  ) => {
    let currentProducts = [...products];
    let newSales = [...sales];
    let failedItems: string[] = [];

    for (const item of items) {
      let pid = item.productId;
      
      if (pid === 'CREATE_NEW') {
        pid = Date.now().toString() + Math.random().toString(36).substring(7);
        const newProd = {
          id: pid,
          name: `[新商品待分类] ${item.productName}`,
          price: item.price,
          stock: 0,
          cost_price: 0
        };
        currentProducts.push(newProd);
        if (supabase) {
          supabase.from('products').insert([{ name: newProd.name, price: newProd.price, stock: 0, cost_price: 0 }]);
        }
      }

      const pIndex = currentProducts.findIndex(p => p.id === pid);
      if (pIndex === -1) {
        failedItems.push(item.productName);
        continue;
      }

      const product = currentProducts[pIndex];
      if (!product.name.startsWith('[新商品待分类]') && product.stock < item.quantity) {
        failedItems.push(product.name);
        continue;
      }

      currentProducts[pIndex] = { ...product, stock: product.stock - item.quantity };
      if (supabase && pid !== 'CREATE_NEW') {
        supabase.from('products').update({ stock: product.stock - item.quantity }).eq('id', pid);
      }
      
      newSales.unshift({
        id: Date.now().toString() + Math.random().toString(36).substring(7),
        productId: pid,
        quantity: item.quantity,
        totalAmount: item.totalAmount,
        salesperson,
        date
      });
    }

    if (failedItems.length < items.length) {
      setProducts(currentProducts);
      setSales(newSales);
    }
    return failedItems;
  };

  return { 
    products, 
    sales, 
    categories,
    addSale, 
    processReceiptSales,
    addCategory,
    deleteCategory,
    addProduct,
    deleteProduct
  };
}
