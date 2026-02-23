// 1. 修正包名
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { base64Data, mimeType } = req.body;
    if (!base64Data) return res.status(400).json({ error: '请上传图片' });

    // 2. 修正初始化
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // 3. 定义 Schema (注意使用 SchemaType)
    const schema = {
      description: "Invoice data extraction",
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
    };

    // 4. 获取模型实例并配置
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash", // 确认正式发布后可去掉 -exp 后缀
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.1,
      },
    });

    const prompt = `你是一个专业的财务 OCR。任务:提取手写发票信息。
抬头关键词:WANG YUWU INTERNATIONAL SPC。
注意：
1. DESCRIPTION 栏手写内容作为 productName。
2. 识别 QTY, RATE, AMOUNT。
3. 日期格式 YYYY-MM-DD。
4. 必须通过 (数量 * 单价 = 总额) 校验，不符时以图片金额为准。`;

    const pureBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");

    // 5. 修正调用结构
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: pureBase64,
          mimeType: mimeType || "image/jpeg"
        }
      }
    ]);

    const response = await result.response;
    const text = response.text(); // 注意：这是一个方法调用
    
    return res.status(200).json(JSON.parse(text));

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'AI 识别失败', details: error.message });
  }
}