import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { base64Data, mimeType } = req.body;
    if (!base64Data) return res.status(400).json({ error: '请上传图片' });

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // 使用 flash 模型，性能好且支持强约束 JSON 输出
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1, // 低温度值提高准确度
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
        }
      }
    });

    const prompt = `你是一个专业的财务 OCR 助手。
任务：识别抬头为 "WANG YUWU INTERNATIONAL SPC" 的手写发票。
特征：包含英语、阿拉伯语、手写体数字。

提取规则：
1. 寻找 'Date' 后面的手写日期，输出格式 YYYY-MM-DD。
2. 'DESCRIPTION' 栏手写内容作为 productName。
3. 'QTY' 为数量, 'RATE' 为单价, 'AMOUNT' 为总额。
4. 如果手写字迹无法确认，请在 error 字段描述原因。
注意：严格返回 JSON，不要包含任何解释文字。`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64Data, mimeType: mimeType || "image/jpeg" } }
    ]);

    const response = await result.response;
    let text = response.text();
    
    // 清洗：防止 AI 返回 ```json ... ``` 这种 Markdown 格式
    const cleanJson = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleanJson);

    return res.status(200).json(parsed);

  } catch (error) {
    console.error('OCR Server Error:', error);
    return res.status(500).json({ error: 'AI 识别失败', details: error.message });
  }
}