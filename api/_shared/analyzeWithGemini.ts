import { GoogleGenAI } from '@google/genai';

const preferredModels = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];

type AnalyzeInput = {
  base64Data: string;
  mimeType?: string;
  prompt: string;
  schema: any;
  temperature?: number;
};

type AnalyzeResult = {
  status: number;
  body: any;
};

function normalizeMimeType(input?: string) {
  const fallback = 'image/jpeg';
  if (!input) return fallback;
  const value = String(input).trim().toLowerCase();
  if (!value) return fallback;
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value)) {
    return fallback;
  }
  return value;
}

function extractBase64Data(input: string) {
  const raw = String(input || '').trim();
  if (!raw) return '';

  const dataUrlMatch = raw.match(/^data:[^;]+;base64,(.+)$/i);
  const payload = (dataUrlMatch ? dataUrlMatch[1] : raw).replace(/\s+/g, '');
  if (!payload) return '';

  if (!/^[A-Za-z0-9+/=]+$/.test(payload)) {
    return '';
  }
  return payload;
}

export function setCors(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export async function analyzeWithGemini({
  base64Data,
  mimeType,
  prompt,
  schema,
  temperature = 0.05
}: AnalyzeInput): Promise<AnalyzeResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { status: 500, body: { error: 'GEMINI_API_KEY is not configured' } };
  }

  const normalizedBase64 = extractBase64Data(base64Data);
  if (!normalizedBase64) {
    return { status: 400, body: { error: '图片数据格式无效，请重新上传图片' } };
  }

  const normalizedMimeType = normalizeMimeType(mimeType);

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
                text: prompt
              },
              {
                inlineData: {
                  data: normalizedBase64,
                  mimeType: normalizedMimeType
                }
              }
            ]
          }
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature
        }
      });
      if (response) break;
    } catch (err: any) {
      lastError = err;
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('rate') || (err?.response && err.response.status === 429)) {
        return { status: 429, body: { error: 'rate_limited', details: err.message || err } };
      }
    }
  }

  if (!response) {
    return { status: 502, body: { error: 'ai_call_failed', details: lastError?.message || 'unknown' } };
  }

  const text = response.text;
  if (!text) return { status: 502, body: { error: 'No response from AI' } };

  try {
    const parsed = JSON.parse(text);
    return { status: 200, body: parsed };
  } catch {
    const snippet = String(text).slice(0, 2000);
    return { status: 502, body: { error: 'AI returned invalid JSON', rawResponseSnippet: snippet } };
  }
}
