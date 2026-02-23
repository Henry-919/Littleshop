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
      try {
        console.log('[API] Attempting with gemini3flash...');
        response = await ai.models.generateContent({
          model: "gemini3flash",
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
      } catch (err: any) {
        console.warn('[API] gemini3flash failed, falling back to gemini-2.0-flash...', err.message);
        // If rate limited or model not available, surface that clearly
        if (err && err.message && err.message.toLowerCase().includes('rate')) {
          return res.status(429).json({ error: 'rate_limited', details: err.message });
        }
        response = await ai.models.generateContent({
          model: "gemini-2.0-flash",
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
  app.get('/api/analytics', (req, res) => {
    res.json({
      bestSellers: [{ name: "示例商品", total_sold: 10 }],
      lowStock: [],
      dailySales: [{ date: "2023-10-01", revenue: 100 }]
    });
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
