import { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from '@google/genai';

const preferredModels = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];

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
        required: ['productName', 'unitPrice', 'quantity', 'totalAmount']
      }
    },
    saleDate: { type: Type.STRING },
    error: { type: Type.STRING }
  },
  required: ['items']
};

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { base64Data, mimeType } = req.body || {};
    if (!base64Data) return res.status(400).json({ error: '请上传图片' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured' });

    const ai = new GoogleGenAI({ apiKey });
    let lastError: any = null;
    let response: any = null;

    for (const modelName of preferredModels) {
      try {
        response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              parts: [
                {
                  text: `任务: 从手写发票提取结构化数据。\n抬头关键词: WANG YUWU INTERNATIONAL SPC。\n规则：\n1) DESCRIPTION 为 productName。\n2) 读取 QTY, RATE, AMOUNT。\n3) 日期格式 YYYY-MM-DD。\n4) 若 数量*单价 与 AMOUNT 不一致，以 AMOUNT 为准。\n仅输出 JSON。`
                },
                {
                  inlineData: {
                    data: base64Data.replace(/^data:image\/\w+;base64,/, ''),
                    mimeType: mimeType || 'image/jpeg'
                  }
                }
              ]
            }
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: schema,
            temperature: 0.05
          }
        });
        if (response) break;
      } catch (err: any) {
        lastError = err;
        const msg = (err?.message || '').toLowerCase();
        if (msg.includes('rate') || (err?.response && err.response.status === 429)) {
          return res.status(429).json({ error: 'rate_limited', details: err.message || err });
        }
        // continue to next model on not found or other errors
      }
    }

    if (!response) {
      return res.status(502).json({ error: 'ai_call_failed', details: lastError?.message || 'unknown' });
    }

    const text = response.text;
    if (!text) return res.status(502).json({ error: 'No response from AI' });

    try {
      const parsed = JSON.parse(text);
      return res.json(parsed);
    } catch (parseErr) {
      // return readable snippet
      const snippet = (text || '').slice(0, 2000);
      return res.status(502).json({ error: 'AI returned invalid JSON', rawResponseSnippet: snippet });
    }
  } catch (error: any) {
    console.error('[api/analyze] error:', error);
    return res.status(500).json({ error: 'Server error', details: error?.message || String(error) });
  }
}
