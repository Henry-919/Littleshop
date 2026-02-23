import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

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

  // Mock analytics endpoint if needed
  app.get('/api/analytics', async (req, res) => {
    try {
      // In a real app, you would fetch this from your database (e.g., Supabase)
      // For now, we'll return mock data that matches the expected structure
      res.json({
        bestSellers: [
          { name: "办公A4纸", total_sold: 150 },
          { name: "黑色中性笔", total_sold: 120 },
          { name: "订书机", total_sold: 85 },
          { name: "文件夹", total_sold: 60 },
          { name: "便签本", total_sold: 45 }
        ],
        lowStock: [
          { id: "1", name: "打印机墨盒", category: "办公耗材", stock: 2 },
          { id: "2", name: "白板笔", category: "文具", stock: 0 },
          { id: "3", name: "透明胶带", category: "文具", stock: 5 }
        ],
        dailySales: [
          { date: "10-01", revenue: 1200 },
          { date: "10-02", revenue: 1500 },
          { date: "10-03", revenue: 900 },
          { date: "10-04", revenue: 2100 },
          { date: "10-05", revenue: 1800 },
          { date: "10-06", revenue: 2400 },
          { date: "10-07", revenue: 3000 }
        ]
      });
    } catch (error) {
      console.error('[API] Analytics Error:', error);
      res.status(500).json({ error: 'Failed to fetch analytics data' });
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
