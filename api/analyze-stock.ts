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
          model: { type: Type.STRING },
          quantity: { type: Type.NUMBER }
        },
        required: ['model', 'quantity']
      }
    },
    error: { type: Type.STRING }
  },
  required: ['items']
};

function setCors(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: any, res: any) {
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
                  text: `任务：从库存单/盘点单/标签图片中提取“产品型号 + 数量”。\n规则：\n1) 只返回可确认的条目。\n2) 型号字段统一到 model。\n3) 数量字段统一到 quantity，必须是数字。\n4) 无法确认的条目不要猜测。\n5) 仅输出 JSON。`
                },
                {
                  inlineData: {
                    data: String(base64Data).replace(/^data:image\/\w+;base64,/, ''),
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
    } catch {
      const snippet = String(text).slice(0, 2000);
      return res.status(502).json({ error: 'AI returned invalid JSON', rawResponseSnippet: snippet });
    }
  } catch (error: any) {
    console.error('[api/analyze-stock] error:', error);
    return res.status(500).json({ error: 'Server error', details: error?.message || String(error) });
  }
}
