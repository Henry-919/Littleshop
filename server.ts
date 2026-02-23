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

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY is not configured' });
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
        }
      };

      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [
          {
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
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0.1,
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error("No response from AI");
      }

      res.json(JSON.parse(text));
    } catch (error: any) {
      console.error('API Error:', error);
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
