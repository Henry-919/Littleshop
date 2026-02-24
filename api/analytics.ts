import { VercelRequest, VercelResponse } from '@vercel/node';

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
    // Mock data for now. Replace with Supabase queries when ready.
    return res.json({
      bestSellers: [
        { name: '办公A4纸', total_sold: 150, revenue: 4500 },
        { name: '黑色中性笔', total_sold: 120, revenue: 2400 },
        { name: '订书机', total_sold: 85, revenue: 2550 },
        { name: '文件夹', total_sold: 60, revenue: 1800 },
        { name: '便签本', total_sold: 45, revenue: 900 }
      ],
      lowStock: [
        { id: '1', name: '打印机墨盒', category: '办公耗材', stock: 2, price: 120 },
        { id: '2', name: '白板笔', category: '文具', stock: 0, price: 8 },
        { id: '3', name: '透明胶带', category: '文具', stock: 5, price: 5 }
      ],
      dailySales: [
        { date: '10-01', revenue: 1200 },
        { date: '10-02', revenue: 1500 },
        { date: '10-03', revenue: 900 },
        { date: '10-04', revenue: 2100 },
        { date: '10-05', revenue: 1800 },
        { date: '10-06', revenue: 2400 },
        { date: '10-07', revenue: 3000 }
      ]
    });
  } catch (error: any) {
    console.error('[api/analytics] error:', error);
    return res.status(500).json({ error: 'Failed to fetch analytics data' });
  }
}
