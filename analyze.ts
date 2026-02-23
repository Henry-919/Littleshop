import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { base64Data, mimeType } = req.body || {};
  if (!base64Data || !mimeType) {
    res.status(400).json({ error: "Missing image data" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY not set" });
    return;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

    const result = await model.generateContent([
      {
        inlineData: {
          data: base64Data.split(",")[1],
          mimeType,
        },
      },
      {
        text: "请识别这张发票的商品明细（商品名、单价、数量、金额）和销售日期，返回JSON数组，字段为productName, unitPrice, quantity, totalAmount, saleDate。",
      },
    ]);

    const text = result.response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      res.status(502).json({
        error: "AI返回内容无法解析为JSON",
        rawResponseSnippet: text.slice(0, 500),
      });
      return;
    }

    res.status(200).json(json);
  } catch (e) {
    res.status(500).json({ error: e.message || "Unknown error" });
  }
}