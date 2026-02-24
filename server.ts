import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '20mb' }));

  // API Route: Analyze Receipt
  app.post("/api/analyze", async (req, res) => {
    try {
      const { base64Data, mimeType } = req.body;
      if (!base64Data) {
        return res.status(400).json({ error: '请上传图片' });
      }

      console.log(`[API] Received analyze request. Image size: ${base64Data.length} chars`);

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.error('[API] GEMINI_API_KEY is missing from environment');
        return res.status(500).json({ error: 'GEMINI_API_KEY is not configured' });
      }

      // Basic sanity check for API key (don't log the full key)
      if (apiKey.length < 10) {
        console.error('[API] GEMINI_API_KEY appears to be too short or invalid');
      }

      const ai = new GoogleGenAI({ apiKey });
      
      const schema = {
        type: Type.OBJECT,
        properties: {
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                productName: { type: Type.STRING },
                unitPrice: { type: Type.NUMBER },
                quantity: { type: Type.NUMBER },
                totalAmount: { type: Type.NUMBER }
              },
              required: ["productName", "unitPrice", "quantity", "totalAmount"]
            }
          },
          saleDate: { type: Type.STRING },
          error: { type: Type.STRING }
        },
        required: ["items"]
      };

      console.log('[API] Calling Gemini AI...');
      let response;
      // Try a list of preferred models in order of preference
      const preferredModels = [
        'gemini-flash-latest',
        'gemini-2.5-flash',
        'gemini-2.0-flash'
      ];

      let lastError: any = null;
      for (const modelName of preferredModels) {
        try {
          console.log(`[API] Attempting model: ${modelName}`);
          response = await ai.models.generateContent({
            model: modelName,
          contents: [{
            parts: [
              {
                text: `你是一个专业的财务 OCR。任务:提取手写发票信息。
抬头关键词:WANG YUWU INTERNATIONAL SPC。
注意：
1. DESCRIPTION 栏手写内容作为 productName。
2. 识别 QTY, RATE, AMOUNT。
3. 日期格式 YYYY-MM-DD。
4. 必须通过 (数量 * 单价 = 总额) 校验，不符时以图片金额为准。`
              },
              {
                inlineData: {
                  data: base64Data.replace(/^data:image\/\w+;base64,/, ""),
                  mimeType: mimeType || "image/jpeg"
                }
              }
            ]
          }],
          config: {
            responseMimeType: "application/json",
            responseSchema: schema,
            temperature: 0.1,
          },
        });
          // If we got a response, break out
          if (response) break;
        } catch (err: any) {
          lastError = err;
          console.warn(`[API] model ${modelName} failed:`, err?.message || err);
          // if it's a 404 for model not found, try next; if rate limited, return immediately
          const msg = (err?.message || '').toLowerCase();
          if (msg.includes('rate') || (err?.response && err.response.status === 429)) {
            return res.status(429).json({ error: 'rate_limited', details: err.message || err });
          }
          // otherwise continue to next model
        }
      }

      // If no response after trying all models, surface the last error
      if (!response) {
        console.error('[API] All preferred models failed', lastError?.message || lastError);
        if (lastError && lastError.response && lastError.response.status === 404) {
          return res.status(502).json({ error: 'model_not_found', details: lastError.message });
        }
        return res.status(502).json({ error: 'ai_call_failed', details: lastError?.message || 'unknown' });
      }

      const text = response.text;
      const status = response?.status || 'unknown';
      const headers = response?.headers || {};
      console.log('[API] Gemini response received', { status });
      if (!text) {
        throw new Error("No response from AI");
      }

      // 尝试解析为 JSON；若非 JSON（例如 HTML 错误页），记录并返回可读错误
      try {
        const parsed = JSON.parse(text);
        return res.json(parsed);
      } catch (parseErr) {
        console.error('[API] Failed to parse AI response as JSON. Status:', status, 'Headers:', headers);
        console.error('[API] Response snippet:', text.slice(0, 800));
        // 如果是明显的限流/未找到模型，返回相应状态
        if (text.toLowerCase().includes('not_found') || text.toLowerCase().includes('not found')) {
          return res.status(502).json({ error: 'model_not_found', rawResponseSnippet: text.slice(0, 1000) });
        }
        if (text.toLowerCase().includes('not allowed') || text.toLowerCase().includes('permission')) {
          return res.status(502).json({ error: 'permission_denied', rawResponseSnippet: text.slice(0, 1000) });
        }
        return res.status(502).json({ error: 'AI returned invalid JSON', rawResponseSnippet: text.slice(0, 1000) });
      }
    } catch (error: any) {
      console.error('[API] Error:', error);
      res.status(500).json({ error: 'AI 识别失败', details: error.message });
    }
  });

  // Analytics endpoint (Supabase)
  app.get('/api/analytics', async (req, res) => {
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
        supabase.from('sales').select('product_id, quantity, total_amount, date').eq('store_id', storeId),
        supabase.from('products').select('id, name, stock, price, category_id').eq('store_id', storeId),
        supabase.from('categories').select('id, name, low_stock_threshold').eq('store_id', storeId)
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
    } catch (error) {
      console.error('[API] Analytics Error:', error);
      return res.status(500).json({ error: 'Failed to fetch analytics data' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile("dist/index.html", { root: "." });
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
