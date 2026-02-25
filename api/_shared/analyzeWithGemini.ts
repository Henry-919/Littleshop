import { GoogleGenAI } from '@google/genai';

const preferredModels = ['gemini-flash-latest'];
const MODEL_TIMEOUT_MS = 30000;

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

  const dataUrlMatch = raw.match(/^data:.*?;base64,(.+)$/i);
  let payload = dataUrlMatch ? dataUrlMatch[1] : raw;

  try {
    payload = decodeURIComponent(payload);
  } catch {
    // keep original payload
  }

  payload = payload.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!payload) return '';

  const remainder = payload.length % 4;
  if (remainder === 2) payload += '==';
  else if (remainder === 3) payload += '=';
  else if (remainder === 1) return '';

  try {
    const decoded = Buffer.from(payload, 'base64');
    if (!decoded || decoded.length === 0) return '';
    return decoded.toString('base64');
  } catch {
    return '';
  }
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

  if (normalizedBase64.length > 2_000_000) {
    return { status: 413, body: { error: '图片过大，请压缩后重试（建议单张不超过 2MB）' } };
  }

  const normalizedMimeType = normalizeMimeType(mimeType);

  const ai = new GoogleGenAI({ apiKey });
  let lastError: any = null;
  let response: any = null;

  const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number) => {
    let timer: any;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('ai_timeout')), timeoutMs);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
  };

  for (const modelName of preferredModels) {
    try {
      response = await withTimeout(ai.models.generateContent({
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
      }), MODEL_TIMEOUT_MS);
      if (response) break;
    } catch (err: any) {
      lastError = err;
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('ai_timeout')) {
        continue;
      }
      if (msg.includes('rate') || (err?.response && err.response.status === 429)) {
        return { status: 429, body: { error: 'rate_limited', details: err.message || err } };
      }
    }
  }

  if (!response) {
    const msg = String(lastError?.message || '').toLowerCase();
    if (msg.includes('ai_timeout')) {
      return { status: 504, body: { error: 'ai_timeout', details: 'AI 响应超时，请稍后重试或减少单次上传图片数量' } };
    }
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
