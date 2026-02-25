import { VercelRequest, VercelResponse } from '@vercel/node';
import { Type } from '@google/genai';
import { analyzeWithGemini, setCors } from './_shared/analyzeWithGemini';

export const config = {
  maxDuration: 60
};

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

const toHalfWidthDigits = (value: string) =>
  value
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

const parseFlexibleNumber = (input: any) => {
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  const raw = toHalfWidthDigits(String(input ?? '').trim());
  if (!raw) return 0;
  const normalized = raw
    .replace(/[,，]/g, '')
    .replace(/[^0-9.\-]/g, '');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
};

const normalizeInvoiceDate = (input: any) => {
  const raw = toHalfWidthDigits(String(input ?? '').trim());
  if (!raw) return undefined;

  let match = raw.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (match) {
    const y = match[1];
    const m = match[2].padStart(2, '0');
    const d = match[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  match = raw.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (match) {
    const d = match[1].padStart(2, '0');
    const m = match[2].padStart(2, '0');
    const y = match[3];
    return `${y}-${m}-${d}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const y = String(parsed.getUTCFullYear());
    const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const d = String(parsed.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return undefined;
};

const normalizeForCompare = (value: string) =>
  String(value || '')
    .toLowerCase()
    .replace(/[\s_\-./\\()[\]{}]+/g, '')
    .replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');

const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }

  return matrix[a.length][b.length];
};

const scoreNameSimilarity = (source: string, target: string) => {
  const sourceNorm = normalizeForCompare(source);
  const targetNorm = normalizeForCompare(target);
  if (!sourceNorm || !targetNorm) return 0;
  if (sourceNorm === targetNorm) return 1;
  if (sourceNorm.includes(targetNorm) || targetNorm.includes(sourceNorm)) return 0.92;
  const maxLen = Math.max(sourceNorm.length, targetNorm.length);
  return maxLen === 0 ? 0 : Math.max(0, 1 - levenshteinDistance(sourceNorm, targetNorm) / maxLen);
};

const modelCodeScore = (name: string) => {
  const value = String(name || '');
  const digits = (value.match(/\d/g) || []).length;
  const letters = (value.match(/[a-z]/gi) || []).length;
  const hyphen = (value.match(/[-_]/g) || []).length;
  return digits * 1.3 + hyphen * 0.6 - letters * 0.45;
};

const normalizeItems = (items: any[], candidates: string[]) => {
  return (Array.isArray(items) ? items : [])
    .map((item: any) => {
      const rawProductName = String(item?.productName || '').trim();
      const quantity = parseFlexibleNumber(item?.quantity);
      const unitPrice = parseFlexibleNumber(item?.unitPrice);
      let totalAmount = parseFlexibleNumber(item?.totalAmount);
      if (!totalAmount && quantity > 0 && unitPrice > 0) {
        totalAmount = Number((quantity * unitPrice).toFixed(3));
      }

      let productName = rawProductName;
      if (rawProductName && candidates.length) {
        const ranked = candidates
          .map((candidate) => ({ name: candidate, score: scoreNameSimilarity(rawProductName, candidate) }))
          .sort((a, b) => b.score - a.score);
        const best = ranked[0];
        if (best && best.score >= 0.72) {
          productName = best.name;
        }
      }

      return { productName, quantity, unitPrice, totalAmount };
    })
    .filter((item: any) => item.productName && item.quantity > 0);
};

const buildAnalyzePrompt = (candidateProducts: string[]) => {
  const candidateBlock = candidateProducts.length
    ? `\n候选商品（若相似请优先使用原文一致写法）：\n${candidateProducts.map((name, index) => `${index + 1}. ${name}`).join('\n')}`
    : '';

  return (
    '任务: 从手写发票提取结构化数据。\n' +
    '抬头关键词: WANG YUWU INTERNATIONAL SPC。\n' +
    '规则：\n' +
    '1) DESCRIPTION 为 productName（优先保留型号字符，如 41901-2、653D-2）。\n' +
    '2) 读取 QTY, RATE, AMOUNT，统一为数字。\n' +
    '3) 只读取页面顶部 Date 字段，忽略印章日期；输出 YYYY-MM-DD。\n' +
    '4) 若 数量*单价 与 AMOUNT 不一致，以 AMOUNT 为准。\n' +
    '5) 忽略空行、印章、签名、页脚条款、小票覆盖区域。\n' +
    '6) 仅输出 JSON。' +
    candidateBlock
  );
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { base64Data, mimeType, candidateProducts } = req.body || {};
    if (!base64Data) return res.status(400).json({ error: '请上传图片' });

    const candidates = Array.isArray(candidateProducts)
      ? candidateProducts
          .map((item: any) => String(item || '').trim())
          .filter(Boolean)
          .slice(0, 120)
      : [];

    const result = await analyzeWithGemini({
      base64Data,
      mimeType,
      prompt: buildAnalyzePrompt(candidates),
      schema,
      temperature: 0.05
    });
    if (result.status !== 200) {
      return res.status(result.status).json(result.body);
    }

    const body = result.body || {};
    let normalizedItems = normalizeItems(body.items, candidates);
    let normalizedDate = normalizeInvoiceDate(body.saleDate);

    const needRefineItems = normalizedItems.some((item: any) => {
      const digitCount = (String(item.productName).match(/\d/g) || []).length;
      return digitCount > 0 && digitCount < 4;
    });
    const needRefineDate = !normalizedDate;

    if (needRefineItems || needRefineDate) {
      const refinePrompt =
        '复核任务：请再次读取同一张发票，仅提取表格已填写行。\n' +
        '重点：DESCRIPTION 常为型号码（数字+连字符，如 41901-2、653D-2），不要将印章或其它区域误读为商品名。\n' +
        '日期只取顶部 Date 字段的手写日期，忽略印章日期。\n' +
        '仅输出 JSON。';

      const refined = await analyzeWithGemini({
        base64Data,
        mimeType,
        prompt: refinePrompt,
        schema,
        temperature: 0
      });

      if (refined.status === 200) {
        const refinedBody = refined.body || {};
        const refinedItems = normalizeItems(refinedBody.items, candidates);
        if (refinedItems.length) {
          const firstA = normalizedItems[0];
          const firstB = refinedItems[0];
          if (!firstA || (firstB && modelCodeScore(firstB.productName) > modelCodeScore(firstA.productName))) {
            normalizedItems = refinedItems;
          }
        }

        const refinedDate = normalizeInvoiceDate(refinedBody.saleDate);
        if (!normalizedDate && refinedDate) {
          normalizedDate = refinedDate;
        }
      }
    }

    return res.status(200).json({
      items: normalizedItems,
      saleDate: normalizedDate
    });
  } catch (error: any) {
    console.error('[api/analyze] error:', error);
    return res.status(500).json({ error: 'Server error', details: error?.message || String(error) });
  }
}
