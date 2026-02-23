import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { base64Data, mimeType } = req.body;

    if (!base64Data || !mimeType) {
      return res.status(400).json({ error: 'Missing image data' });
    }

    // 1. 初始化 SDK (确保包名正确)
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // 2. 使用正确的模型名称 (1.5-flash 速度快且支持 JSON 模式)
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            items: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  productName: { type: SchemaType.STRING },
                  unitPrice: { type: SchemaType.NUMBER },
                  quantity: { type: SchemaType.NUMBER },
                  totalAmount: { type: SchemaType.NUMBER }
                },
                required: ["productName", "unitPrice", "quantity", "totalAmount"]
              }
            },
            saleDate: { type: SchemaType.STRING },
            error: { type: SchemaType.STRING }
          }
        },
      },
    });

    // 3. 构建请求内容
    const prompt = "你是一个专业的财务会计 AI。请识别这张手写发票图片。发票特征：抬头：WANG YUWU INTERNATIONAL SPC。语言：阿拉伯语、英语、手写体。提取要求：Date: 准确识别手写日期（如 2026-02-20）。Items: 提取 DESCRIPTION 栏的手写内容作为 productName。Math Check: 提取 QTY (数量) 作为 quantity, RATE (单价) 作为 unitPrice, AMOUNT (总额) 作为 totalAmount。验证公式：QTY * RATE = AMOUNT。如果图片模糊或信息缺失，请在 error 字段说明。";

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Data,
          mimeType: mimeType
        }
      }
    ]);

    // 4. 获取结果内容
    const response = await result.response;
    const jsonStr = response.text(); // 注意这里是函数调用

    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      return res.status(200).json(parsed);
    } else {
      return res.status(500).json({ error: 'Gemini 返回内容为空' });
    }

  } catch (error) {
    console.error('OCR Error Detailed:', error);
    // 向前端返回具体的错误信息方便调试
    return res.status(500).json({ 
      error: 'AI 处理异常', 
      details: error.message 
    });
  }
}