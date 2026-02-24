import { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const rawThreshold = (req.query.lowStockThreshold as string) || process.env.LOW_STOCK_THRESHOLD || '5';
    const lowStockThreshold = Math.max(0, Number.parseInt(rawThreshold, 10) || 5);

    const storeId = req.query.storeId as string | undefined;
    if (!storeId) {
      return res.status(400).json({ error: 'storeId is required' });
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Supabase env is not configured' });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const [salesRes, productsRes, categoriesRes] = await Promise.all([
      supabase.from('sales').select('product_id, quantity, total_amount, date').eq('store_id', storeId).is('deleted_at', null),
      supabase.from('products').select('id, name, stock, price, category_id').eq('store_id', storeId).is('deleted_at', null),
      supabase.from('categories').select('id, name, low_stock_threshold').eq('store_id', storeId).is('deleted_at', null)
    ]);

    if (salesRes.error || productsRes.error || categoriesRes.error) {
      const error = salesRes.error || productsRes.error || categoriesRes.error;
      return res.status(500).json({ error: error?.message || 'Supabase query failed' });
    }

    const products = productsRes.data || [];
    const sales = salesRes.data || [];
    const categories = categoriesRes.data || [];

    const productMap = new Map(products.map((p: any) => [p.id, p]));
    const categoryMap = new Map(categories.map((c: any) => [c.id, c.name]));
    const categoryThresholdMap = new Map(categories.map((c: any) => [c.id, c.low_stock_threshold]));

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const monthSales = sales.filter((sale: any) => {
      if (!sale.date) return false;
      const saleDate = new Date(sale.date);
      if (Number.isNaN(saleDate.getTime())) return false;
      return saleDate >= monthStart && saleDate <= monthEnd;
    });

    const bestSellerMap = new Map<string, { name: string; total_sold: number; revenue: number }>();
    for (const sale of monthSales) {
      const product = productMap.get(sale.product_id);
      const name = product?.name || '未知商品';
      const current = bestSellerMap.get(sale.product_id) || { name, total_sold: 0, revenue: 0 };
      current.total_sold += Number(sale.quantity) || 0;
      current.revenue += Number(sale.total_amount) || 0;
      bestSellerMap.set(sale.product_id, current);
    }

    const bestSellers = Array.from(bestSellerMap.values())
      .sort((a, b) => b.total_sold - a.total_sold)
      .slice(0, 5);

    const lowStock = products
      .filter((p: any) => {
        const categoryThreshold = categoryThresholdMap.get(p.category_id);
        const threshold = categoryThreshold === null || categoryThreshold === undefined
          ? lowStockThreshold
          : Number(categoryThreshold);
        return Number(p.stock) <= threshold;
      })
      .map((p: any) => ({
        id: p.id,
        name: p.name,
        category: categoryMap.get(p.category_id) || '未分类',
        stock: Number(p.stock) || 0,
        price: Number(p.price) || 0
      }));

    const pad2 = (n: number) => String(n).padStart(2, '0');
    const formatDay = (d: Date) => `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

    const dailySalesMap = new Map<string, number>();
    for (const sale of monthSales) {
      const date = sale.date ? new Date(sale.date) : null;
      if (!date || Number.isNaN(date.getTime())) continue;
      const key = formatDay(date);
      dailySalesMap.set(key, (dailySalesMap.get(key) || 0) + (Number(sale.total_amount) || 0));
    }

    const dailySales = [] as { date: string; revenue: number }[];
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(now.getFullYear(), now.getMonth(), day);
      const key = formatDay(d);
      dailySales.push({ date: key, revenue: Math.round((dailySalesMap.get(key) || 0) * 100) / 100 });
    }

    return res.json({ bestSellers, lowStock, dailySales });
  } catch (error: any) {
    console.error('[api/analytics] error:', error);
    return res.status(500).json({ error: 'Failed to fetch analytics data' });
  }
}
