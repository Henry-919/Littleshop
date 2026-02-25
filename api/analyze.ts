import { VercelRequest, VercelResponse } from '@vercel/node';
import { Type } from '@google/genai';
import { analyzeWithGemini, setCors } from './_shared/analyzeWithGemini.js';

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

  // YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
  let match = raw.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (match) {
    const y = match[1];
    const m = match[2].padStart(2, '0');
    const d = match[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY (common on Arabic/Omani invoices)
  match = raw.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (match) {
    const part1 = parseInt(match[1], 10);
    const part2 = parseInt(match[2], 10);
    const y = match[3];
    // Heuristic: if part1 > 12, it must be the day
    let d: string, m: string;
    if (part1 > 12) {
      d = String(part1).padStart(2, '0');
      m = String(part2).padStart(2, '0');
    } else if (part2 > 12) {
      m = String(part1).padStart(2, '0');
      d = String(part2).padStart(2, '0');
    } else {
      // Ambiguous — assume DD-MM-YYYY (European/Arabic convention)
      d = String(part1).padStart(2, '0');
      m = String(part2).padStart(2, '0');
    }
    return `${y}-${m}-${d}`;
  }

  // DD-MM-YY or DD/MM/YY or DD.MM.YY (2-digit year)
  match = raw.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})(?!\d)/);
  if (match) {
    const part1 = parseInt(match[1], 10);
    const part2 = parseInt(match[2], 10);
    const shortYear = parseInt(match[3], 10);
    const y = String(shortYear >= 0 && shortYear <= 50 ? 2000 + shortYear : 1900 + shortYear);
    let d: string, m: string;
    if (part1 > 12) {
      d = String(part1).padStart(2, '0');
      m = String(part2).padStart(2, '0');
    } else if (part2 > 12) {
      m = String(part1).padStart(2, '0');
      d = String(part2).padStart(2, '0');
    } else {
      d = String(part1).padStart(2, '0');
      m = String(part2).padStart(2, '0');
    }
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
    ? `\n\n已知商品列表（识别结果请优先匹配，但不要强行匹配不存在的商品）：\n${candidateProducts.map((name, index) => `${index + 1}. ${name}`).join('\n')}`
    : '';

  return (
    '你是一个专业的手写发票 OCR 系统。请仔细分析图片中的手写发票，提取所有商品行数据。\n' +
    '\n' +
    '## 发票模板\n' +
    '这是 WANG YUWU INTERNATIONAL SPC（阿曼苏丹国）的手写现金发票(CASH INVOICE)。\n' +
    '表格列从左到右：ITEM编号 | DESCRIPTION（商品描述）| QTY（数量）| RATE/السعر（单价）| AMOUNT/المبلغ（金额，分R.O.和Bz.两小列）\n' +
    '\n' +
    '## 关键提取规则\n' +
    '\n' +
    '### 商品名称 (productName)\n' +
    '- 来自 DESCRIPTION 列的手写文字\n' +
    '- 通常是产品型号编码，例如：M-2504、F802A-1-5、K-05-2、41901-2、653D-2、Ly-159-2\n' +
    '- ⚠️ 描述可能跨越多行！同一 ITEM 编号下的所有行都属于同一个商品。例如第一行写 "M-2504 (Silver)"、第二行写 "Small-Ward"，它们合在一起是一个商品名\n' +
    '- 多行描述用空格连接为一个完整名称，如 "M-2504 (Silver) Small-Ward"\n' +
    '- 手写字符易混淆的对照：0↔O、1↔l↔I、5↔S、8↔B、2↔Z、6↔G\n' +
    '- 保留原始大小写、连字符、括号\n' +
    '\n' +
    '### 数量、价格、金额\n' +
    '- QTY → quantity（整数）\n' +
    '- RATE → unitPrice（单价，R.O.列的数字）\n' +
    '- AMOUNT → totalAmount：\n' +
    '  - 若只有 R.O.列有值 → 直接取该数字\n' +
    '  - 若 Bz.列也有值 → totalAmount = R.O.部分 + Bz.部分/1000（例：36 R.O. + 500 Bz. = 36.5）\n' +
    '- 若 QTY × RATE ≠ AMOUNT，以手写的 AMOUNT 为准\n' +
    '\n' +
    '### 日期 (saleDate)\n' +
    '- 读取表格上方 "Date:" 字段的手写日期\n' +
    '- 格式可能是 DD.MM.YY、DD-MM-YYYY、DD/MM/YYYY 等\n' +
    '- 输出格式：DD-MM-YYYY（若是2位年份，补全为4位：26→2026）\n' +
    '- ⚠️ 忽略图中任何银行回单、POS单据上的日期\n' +
    '\n' +
    '### 必须忽略的内容\n' +
    '- 图片中叠放的小型银行回单、POS刷卡单据（通常在角落，有"SALE"、"TOTAL"、银行logo等字样）\n' +
    '- ITEM 列的序号（0, 1, 2...）不是商品名\n' +
    '- 空行、印章(HAISHENG等)、签名、条款(Terms of warranty)、Total Amount 汇总行\n' +
    '- 被其他纸张覆盖遮挡的区域\n' +
    '\n' +
    '### 输出要求\n' +
    '- 仅输出 JSON，不要输出解释文字\n' +
    '- 每个有效商品行必须输出，不允许遗漏\n' +
    '- 仔细检查每一行：看到 QTY 列有数字就说明该行是有效商品行' +
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
      temperature: 0.05,
      models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite']
    });
    if (result.status === 504) {
      return res.status(200).json({ items: [], error: 'ai_timeout' });
    }
    if (result.status !== 200) {
      return res.status(result.status).json(result.body);
    }

    const body = result.body || {};
    const normalizedItems = normalizeItems(body.items, candidates);
    const normalizedDate = normalizeInvoiceDate(body.saleDate);

    return res.status(200).json({
      items: normalizedItems,
      saleDate: normalizedDate
    });
  } catch (error: any) {
    console.error('[api/analyze] error:', error);
    return res.status(500).json({ error: 'Server error', details: error?.message || String(error) });
  }
}
