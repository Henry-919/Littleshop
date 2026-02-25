import { Type } from '@google/genai';
import { analyzeWithGemini, setCors } from './_shared/analyzeWithGemini.js';

export const config = {
  maxDuration: 300
};

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

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { base64Data, mimeType } = req.body || {};
    if (!base64Data) return res.status(400).json({ error: '请上传图片' });

    const result = await analyzeWithGemini({
      base64Data,
      mimeType,
      prompt:
        '任务：从库存单/盘点单/标签图片中提取“产品型号 + 数量”。\n规则：\n1) 只返回可确认的条目。\n2) 型号字段统一到 model。\n3) 数量字段统一到 quantity，必须是数字。\n4) 无法确认的条目不要猜测。\n5) 仅输出 JSON。',
      schema,
      temperature: 0.05
    });

    if (result.status === 504) {
      return res.status(200).json({ items: [], error: 'ai_timeout' });
    }

    return res.status(result.status).json(result.body);
  } catch (error: any) {
    console.error('[api/analyze-stock] error:', error);
    return res.status(500).json({ error: 'Server error', details: error?.message || String(error) });
  }
}
