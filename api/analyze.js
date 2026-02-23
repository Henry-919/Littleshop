import { GoogleGenAI, Type } from '@google/genai';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { base64Data, mimeType } = req.body;
    if (!base64Data) return res.status(400).json({ error: '请上传图片' });

    // 初始化最新 SDK
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    const prompt = `你是一个专业的财务 OCR。任务：提取手写发票信息。
抬头关键词：WANG YUWU INTERNATIONAL SPC。
注意：
1. DESCRIPTION 栏手写内容作为 productName。
2. 识别 QTY (数量), RATE (单价), AMOUNT (总额)。
3. 识别 Date (日期) 为 YYYY-MM-DD。
4. 必须通过 (数量 * 单价 = 总额) 校验，如不符以图片上的总额为准。`;

    // 自动清洗可能携带的 Base64 前缀
    const pureBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { data: pureBase64, mimeType: mimeType || "image/jpeg" } },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
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
        }
      }
    });

    const text = response.text;
    return res.status(200).json(JSON.parse(text));

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'AI 识别失败', details: error.message });
  }
}
