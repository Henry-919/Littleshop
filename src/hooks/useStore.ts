import { create } from 'zustand';
import { supabase } from '../lib/supabase';

interface Product {
  id: string;
  name: string;
  price: number;
  cost_price: number;
  stock: number;
  category_id?: string;
  categories?: { name: string }; // 兼容关联查询
}

interface Sale {
  id: string;
  product_id: string;
  quantity: number;
  total_price: number;
  created_at: string;
  products?: { name: string };
}

interface State {
  products: Product[];
  sales: Sale[];
  categories: any[];
  isLoading: boolean;
  fetchData: () => Promise<void>;
  addProduct: (product: any) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  addSale: (sale: any) => Promise<void>;
  deleteSale: (id: string) => Promise<void>;
}

export const useStore = create<State>((set, get) => ({
  products: [],
  sales: [],
  categories: [],
  isLoading: false,

  fetchData: async () => {
    set({ isLoading: true });
    try {
      // 获取商品（带类目名称）
      const { data: products } = await supabase
        .from('products')
        .select('*, categories(name)')
        .order('created_at', { ascending: false });

      // 获取销售历史（带商品名称）
      const { data: sales } = await supabase
        .from('sales')
        .select('*, products(name)')
        .order('created_at', { ascending: false });

      // 获取所有类目供下拉框使用
      const { data: categories } = await supabase.from('categories').select('*');

      set({ 
        products: products || [], 
        sales: sales || [], 
        categories: categories || [] 
      });
    } finally {
      set({ isLoading: false });
    }
  },

  addProduct: async (newProd) => {
    const normalizedName = newProd.name.trim();
    
    // 1. 查重逻辑：不区分大小写，且去掉首尾空格
    const { data: existing } = await supabase
      .from('products')
      .select('*')
      .ilike('name', normalizedName)
      .maybeSingle();

    if (existing) {
      // 2. 存在则累加库存，并更新价格（如果发生了变化）
      const { error } = await supabase
        .from('products')
        .update({ 
          stock: Number(existing.stock) + Number(newProd.stock),
          price: newProd.price || existing.price,
          cost_price: newProd.cost_price || existing.cost_price
        })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      // 3. 不存在则作为新商品插入
      const { error } = await supabase
        .from('products')
        .insert([{ ...newProd, name: normalizedName }]);
      if (error) throw error;
    }
    await get().fetchData();
  },

  deleteProduct: async (id) => {
    // 物理删除（因为我们已经去掉了 is_deleted 逻辑）
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) throw error;
    await get().fetchData();
  },

  addSale: async (sale) => {
    // 1. 插入销售记录
    const { error: saleError } = await supabase.from('sales').insert([sale]);
    if (saleError) throw saleError;

    // 2. 自动减库存逻辑（这是 Littleshop 最需要的）
    const { data: prod } = await supabase
      .from('products')
      .select('stock')
      .eq('id', sale.product_id)
      .single();

    if (prod) {
      await supabase
        .from('products')
        .update({ stock: prod.stock - sale.quantity })
        .eq('id', sale.product_id);
    }
    await get().fetchData();
  },

  deleteSale: async (id) => {
    // 1. 获取要删除的销售信息以便恢复库存
    const { data: sale } = await supabase.from('sales').select('*').eq('id', id).single();
    
    if (sale) {
      // 2. 恢复库存
      const { data: prod } = await supabase.from('products').select('stock').eq('id', sale.product_id).single();
      if (prod) {
        await supabase.from('products')
          .update({ stock: prod.stock + sale.quantity })
          .eq('id', sale.product_id);
      }
    }

    // 3. 删除销售记录
    const { error } = await supabase.from('sales').delete().eq('id', id);
    if (error) throw error;
    await get().fetchData();
  }
}));