import { GoogleGenAI, Type } from '@google/genai';

export default async function handler(req, res) {
  // 仅允许 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { base64Data, mimeType } = req.body;

    if (!base64Data || !mimeType) {
      return res.status(400).json({ error: 'Missing image data' });
    }

    // 从环境变量读取 Gemini API Key
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType
            }
          },
          {
            text: "你是一个专业的财务会计 AI。请识别这张手写发票图片。发票特征：抬头：WANG YUWU INTERNATIONAL SPC。语言：阿拉伯语、英语、手写体。提取要求：Date: 准确识别手写日期（如 2026-02-20）。Items: 提取 DESCRIPTION 栏的手写内容（例如 'Ly-74-2'）作为 productName。Math Check: 提取 QTY (数量) 作为 quantity, RATE (单价) 作为 unitPrice, AMOUNT (总额) 作为 totalAmount。验证公式：QTY * RATE = AMOUNT。如果图片模糊或信息缺失，请在 error 字段说明。Output: 请直接返回 JSON 格式，不要有任何多余的文字描述。"
          }
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
            saleDate: { type: Type.STRING, description: "Date of the sale in YYYY-MM-DD format" },
            error: { type: Type.STRING, description: "Error message if information is missing or blurry" }
          }
        }
      }
    });

    const jsonStr = response.text;
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      return res.status(200).json(parsed);
    } else {
      return res.status(500).json({ error: 'Failed to parse the receipt.' });
    }
  } catch (error) {
    console.error('OCR Error:', error);
    return res.status(500).json({ error: 'An error occurred while processing the image.' });
  }
}
