import { useState, useEffect } from 'react';
import { Product, Sale } from '../types';

const INITIAL_PRODUCTS: Product[] = [
  { id: '1', name: 'Coca Cola', stock: 50, price: 1.5 },
  { id: '2', name: 'Lays Chips', stock: 30, price: 2.0 },
  { id: '3', name: 'Water Bottle', stock: 100, price: 1.0 },
  { id: '4', name: 'Chocolate Bar', stock: 4, price: 1.8 },
  { id: '5', name: 'Notebook', stock: 5, price: 3.5 },
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

  useEffect(() => {
    localStorage.setItem('shop_products', JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    localStorage.setItem('shop_sales', JSON.stringify(sales));
  }, [sales]);

  const addSale = (productId: string, quantity: number, salesperson: string, date?: string) => {
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
        currentProducts.push({
          id: pid,
          name: `[新商品待分类] ${item.productName}`,
          price: item.price,
          stock: 0
        });
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

  return { products, sales, addSale, processReceiptSales };
}
