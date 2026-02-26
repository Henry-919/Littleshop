import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Upload, CheckCircle, AlertCircle, Loader2, Save, X } from 'lucide-react';
import heic2any from 'heic2any';

type MatchCandidate = {
  productId: string;
  productName: string;
  score: number;
};

type ParsedReceiptItem = {
  productName: string;
  unitPrice: number;
  quantity: number;
  totalAmount: number;
};

type ReviewItem = ParsedReceiptItem & {
  reason: string;
  bestCandidate?: MatchCandidate;
  hasMathDiscrepancy: boolean;
};

type PreviewItem = ParsedReceiptItem & {
  status: 'auto' | 'review';
  reason: string;
  bestCandidate?: MatchCandidate;
  hasMathDiscrepancy: boolean;
};

type PendingAnalysis = {
  saleDate?: string;
  totalItems: number;
  autoSales: Array<{ productId: string; productName: string; quantity: number; unitPrice: number; totalAmount: number }>;
  reviewItems: ReviewItem[];
  previewItems: PreviewItem[];
};

type ReceiptReport = {
  saleDate?: string;
  totalItems: number;
  autoMatchedItems: number;
  manualMatchedItems: number;
  reviewItems: ReviewItem[];
};

type RecognitionHistoryEntry = {
  id: string;
  createdAt: string;
  saleDate?: string;
  totalItems: number;
  autoMatchedItems: number;
  reviewItems: number;
  items: Array<{ productName: string; quantity: number; unitPrice: number; totalAmount: number; status: 'auto' | 'review' }>;
};

const RECOGNITION_HISTORY_KEY = 'receipt_recognition_history_v1';
const RECOGNITION_HISTORY_LIMIT = 30;

const AUTO_MATCH_SCORE = 0.88;
const AMBIGUOUS_GAP = 0.08;

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[\s_\-./\\()[\]{}]+/g, '')
    .replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');

const tokenize = (value: string) => {
  const normalized = value.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]+/g, ' ').trim();
  if (!normalized) return [] as string[];
  return normalized.split(/\s+/).filter(Boolean);
};

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

const jaccardSimilarity = (aTokens: string[], bTokens: string[]) => {
  if (!aTokens.length || !bTokens.length) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let intersection = 0;
  for (const token of aSet) {
    if (bSet.has(token)) intersection++;
  }
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : intersection / union;
};

const scoreNameSimilarity = (source: string, target: string) => {
  const sourceNormalized = normalizeText(source);
  const targetNormalized = normalizeText(target);

  if (!sourceNormalized || !targetNormalized) return 0;
  if (sourceNormalized === targetNormalized) return 1;
  if (sourceNormalized.includes(targetNormalized) || targetNormalized.includes(sourceNormalized)) return 0.92;

  const maxLen = Math.max(sourceNormalized.length, targetNormalized.length);
  const editScore = maxLen === 0 ? 0 : 1 - levenshteinDistance(sourceNormalized, targetNormalized) / maxLen;
  const tokenScore = jaccardSimilarity(tokenize(source), tokenize(target));
  const finalScore = editScore * 0.65 + tokenScore * 0.35;
  return Math.max(0, Math.min(1, finalScore));
};

// 2. 图片压缩工具函数：与批量补库存识别链路保持一致
const compressImageDataUrl = (
  dataUrl: string,
  outputType: 'image/jpeg' | 'image/png' = 'image/jpeg',
  options?: { maxWidth?: number; jpegQuality?: number }
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = options?.maxWidth || 1600;
      const JPEG_QUALITY = typeof options?.jpegQuality === 'number' ? options.jpegQuality : 0.85;
      let width = img.width;
      let height = img.height;

      if (width > MAX_WIDTH) {
        height *= MAX_WIDTH / width;
        width = MAX_WIDTH;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error("Canvas context failed"));
      
      ctx.drawImage(img, 0, 0, width, height);
      const compressed = outputType === 'image/png'
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      resolve(compressed);
    };
    img.onerror = () => reject(new Error("图片加载失败"));
  });
};

const fileToDataUrl = (file: File | Blob) => {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(String(ev.target?.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
};

const isHeicLike = (file: File) => {
  const type = String(file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  return type.includes('heic') || type.includes('heif') || /\.(heic|heif)$/.test(name);
};

const toJpegDataUrlIfNeeded = async (file: File) => {
  if (!isHeicLike(file)) {
    return fileToDataUrl(file);
  }

  try {
    const converted = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.9
    });

    const jpegBlob = Array.isArray(converted) ? converted[0] : converted;
    if (!(jpegBlob instanceof Blob)) {
      throw new Error('HEIC 转换失败');
    }

    return fileToDataUrl(jpegBlob);
  } catch {
    throw new Error('HEIC 图片转换失败，请在 iPhone 相机设置中选择“兼容性最佳”后重试');
  }
};

export function ReceiptScanner({ store }: { store: any }) {
  const { products, addSale } = store;
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingAuto, setApplyingAuto] = useState(false);
  const [applyingManual, setApplyingManual] = useState(false);
  const [pendingAnalysis, setPendingAnalysis] = useState<PendingAnalysis | null>(null);
  const [report, setReport] = useState<ReceiptReport | null>(null);
  const [manualSelections, setManualSelections] = useState<Record<number, string>>({});
  const [editableProductNames, setEditableProductNames] = useState<Record<number, string>>({});
  const [editablePrices, setEditablePrices] = useState<Record<number, { unitPrice: string; totalAmount: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [salesperson, setSalesperson] = useState('自动扫描');
  const [saleDateInput, setSaleDateInput] = useState('');
  const [recognitionHistory, setRecognitionHistory] = useState<RecognitionHistoryEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECOGNITION_HISTORY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setRecognitionHistory(parsed.slice(0, RECOGNITION_HISTORY_LIMIT));
      }
    } catch {
      setRecognitionHistory([]);
    }
  }, []);

  const persistRecognitionHistory = (next: RecognitionHistoryEntry[]) => {
    setRecognitionHistory(next);
    try {
      localStorage.setItem(RECOGNITION_HISTORY_KEY, JSON.stringify(next));
    } catch {
      // ignore storage write failures
    }
  };

  const productIndex = useMemo(() => {
    return (products || []).map((p: any) => ({ id: p.id, name: p.name }));
  }, [products]);

  const selectedManualCount = useMemo(() => {
    return Object.values(manualSelections).filter(Boolean).length;
  }, [manualSelections]);

  // 图片上传处理
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setLoading(true);
    setError(null);
    try {
      const base64Images = await Promise.all(files.map((file) => toJpegDataUrlIfNeeded(file)));
      setImages(prev => [...prev, ...base64Images]);
    } catch (err) {
      setError((err as any)?.message || '图片读取失败');
    } finally {
      setLoading(false);
    }
  };

  const buildMatchPreview = (items: ParsedReceiptItem[], saleDate?: string) => {
    const autoSales: Array<{ productId: string; productName: string; quantity: number; unitPrice: number; totalAmount: number }> = [];
    const reviewItems: ReviewItem[] = [];
    const previewItems: PreviewItem[] = [];

    items.forEach((item) => {
      const ranked = productIndex
        .map((product: any) => ({
          productId: product.id,
          productName: product.name,
          score: scoreNameSimilarity(item.productName, product.name)
        }))
        .sort((a: MatchCandidate, b: MatchCandidate) => b.score - a.score);

      const best = ranked[0];
      const second = ranked[1];
      const hasMathDiscrepancy = Math.abs(item.unitPrice * item.quantity - item.totalAmount) > 0.1;

      if (!best || best.score < AUTO_MATCH_SCORE) {
        const reviewItem: ReviewItem = {
          ...item,
          reason: '匹配分低于高置信阈值',
          bestCandidate: best,
          hasMathDiscrepancy
        };
        reviewItems.push(reviewItem);
        previewItems.push({ ...reviewItem, status: 'review' });
        return;
      }

      if (second && best.score - second.score < AMBIGUOUS_GAP) {
        const reviewItem: ReviewItem = {
          ...item,
          reason: '存在多个相近商品，匹配不够唯一',
          bestCandidate: best,
          hasMathDiscrepancy
        };
        reviewItems.push(reviewItem);
        previewItems.push({ ...reviewItem, status: 'review' });
        return;
      }

      autoSales.push({
        productId: best.productId,
        productName: best.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalAmount: item.totalAmount
      });
      previewItems.push({
        ...item,
        status: 'auto',
        reason: '高置信度且匹配唯一',
        bestCandidate: best,
        hasMathDiscrepancy
      });
    });

    const nextSelections: Record<number, string> = {};
    reviewItems.forEach((item, index) => {
      if (item.bestCandidate) nextSelections[index] = item.bestCandidate.productId;
    });
    setManualSelections(nextSelections);

    setPendingAnalysis({
      saleDate,
      totalItems: items.length,
      autoSales,
      reviewItems,
      previewItems
    });
    const nextEditableNames: Record<number, string> = {};
    const nextEditablePrices: Record<number, { unitPrice: string; totalAmount: string }> = {};
    previewItems.forEach((item, index) => {
      nextEditableNames[index] = item.productName;
      nextEditablePrices[index] = {
        unitPrice: item.unitPrice > 0 ? String(item.unitPrice) : '',
        totalAmount: item.totalAmount > 0 ? String(item.totalAmount) : ''
      };
    });
    setEditableProductNames(nextEditableNames);
    setEditablePrices(nextEditablePrices);
    setSaleDateInput(saleDate || '');
    setReport(null);

    return {
      saleDate,
      totalItems: items.length,
      autoMatchedItems: autoSales.length,
      reviewItems: reviewItems.length,
      previewItems
    };
  };

  const applyEditedProductName = (index: number) => {
    if (!pendingAnalysis) return;
    const current = pendingAnalysis.previewItems[index];
    if (!current) return;

    const edited = String(editableProductNames[index] || '').trim();
    if (!edited) {
      setEditableProductNames((prev) => ({ ...prev, [index]: current.productName }));
      return;
    }

    if (edited === current.productName) return;

    const nextItems: ParsedReceiptItem[] = pendingAnalysis.previewItems.map((item, idx) => ({
      productName: idx === index ? edited : item.productName,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      totalAmount: item.totalAmount
    }));

    buildMatchPreview(nextItems, pendingAnalysis.saleDate);
  };

  // 核心：识别 -> 匹配 -> 预览
  const processImage = async () => {
    if (images.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const parsedItems: ParsedReceiptItem[] = [];
      let detectedDate = '';
      let failedCount = 0;
      const failureMessages: string[] = [];
      const candidateProducts = Array.from(new Set((productIndex || []).map((item: any) => String(item?.name || '').trim()).filter(Boolean))).slice(0, 120);

      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      const callAnalyzeApi = async (payloadDataUrl: string, strategyLabel: string) => {
        const RETRIES = 2;

        for (let attempt = 1; attempt <= RETRIES; attempt++) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 60000);
          try {
            const response = await fetch('/api/analyze', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ base64Data: payloadDataUrl, mimeType: payloadDataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg', candidateProducts }),
              signal: controller.signal
            });
            clearTimeout(timer);
            const text = await response.text();
            let payload: any = null;
            try {
              payload = text ? JSON.parse(text) : null;
            } catch {
              payload = null;
            }
            if (!response.ok) {
              const snippet = text ? text.slice(0, 160) : '';
              const errMsg = `[${strategyLabel}] ${payload?.error || `HTTP ${response.status}`} ${snippet}`.trim();
              const lower = errMsg.toLowerCase();
              const isRetriable = lower.includes('function_invocation_failed') || lower.includes('ai_timeout') || lower.includes('http 500') || lower.includes('http 504') || lower.includes('http 502');
              if (isRetriable && attempt < RETRIES) {
                await sleep(450 * attempt);
                continue;
              }
              throw new Error(errMsg);
            }
            if (!payload) {
              throw new Error(`[${strategyLabel}] 服务端返回了非 JSON 内容`);
            }
            return payload;
          } catch (err: any) {
            clearTimeout(timer);
            const msg = String(err?.message || err || '').toLowerCase();
            const isRetriable = msg.includes('abort') || msg.includes('timeout') || msg.includes('function_invocation_failed');
            if (isRetriable && attempt < RETRIES) {
              await sleep(450 * attempt);
              continue;
            }
            throw err;
          }
        }

        throw new Error(`[${strategyLabel}] AI 解析失败`);
      };

      const isParseRelatedError = (error: any) => {
        const msg = String(error?.message || error || '').toLowerCase();
        return (
          msg.includes('图片数据格式无效') ||
          msg.includes('图片格式解析失败') ||
          msg.includes('expected pattern') ||
          msg.includes('invalid image') ||
          msg.includes('invalid argument')
        );
      };

      for (const imageDataUrl of images) {
        try {
          const retryCandidates: Array<{ label: string; makeDataUrl: () => Promise<string> }> = [
            { label: 'jpeg-hq', makeDataUrl: () => compressImageDataUrl(imageDataUrl, 'image/jpeg', { maxWidth: 1600, jpegQuality: 0.85 }) },
            { label: 'png-fallback', makeDataUrl: () => compressImageDataUrl(imageDataUrl, 'image/png', { maxWidth: 1600 }) },
          ];

          let payload: any = null;
          let lastRetryError: any = null;

          for (let i = 0; i < retryCandidates.length; i++) {
            try {
              const candidate = retryCandidates[i];
              const candidateDataUrl = await candidate.makeDataUrl();
              payload = await callAnalyzeApi(candidateDataUrl, candidate.label);
              lastRetryError = null;
              break;
            } catch (retryErr: any) {
              lastRetryError = retryErr;
              if (!isParseRelatedError(retryErr)) {
                throw retryErr;
              }
            }
          }

          if (!payload && lastRetryError) {
            throw lastRetryError;
          }

          if (payload?.saleDate) detectedDate = payload.saleDate;

          const items = Array.isArray(payload?.items) ? payload.items : [];
          items.forEach((item: any) => {
            const productName = String(item?.productName || '').trim();
            const unitPrice = Number(item?.unitPrice ?? 0);
            const quantity = Number(item?.quantity ?? 0);
            const totalAmount = Number(item?.totalAmount ?? 0);
            if (!productName || !Number.isFinite(quantity) || quantity <= 0) return;
            parsedItems.push({
              productName,
              unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
              quantity,
              totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0
            });
          });
        } catch (singleErr: any) {
          failedCount += 1;
          const rawMessage = String(singleErr?.message || singleErr || '识别失败');
          const lower = rawMessage.toLowerCase();
          const message = lower.includes('did not match the expected pattern')
            ? '图片格式解析失败，请重拍或改用 JPG/PNG 图片'
            : lower.includes('ai_timeout')
              ? '云端识别超时，请减少单次上传图片数量后重试'
              : lower.includes('图片过大') || lower.includes('http 413')
                ? '图片体积过大，请重拍或压缩后再识别'
            : lower.includes('function_invocation_failed')
              ? '云端识别函数执行失败（可能超时或运行时异常），请稍后重试'
              : rawMessage;
          failureMessages.push(message);
        }
      }

      if (parsedItems.length === 0) {
        const head = failureMessages[0] || '未识别到可用商品数据，请检查发票清晰度';
        setError(images.length > 1 ? `${head}（共 ${failedCount} 张失败）` : head);
        return;
      }

      if (failedCount > 0) {
        setError(`部分图片识别失败（${failedCount}/${images.length}），其余结果已生成预览`);
      }

      const summary = buildMatchPreview(parsedItems, detectedDate || undefined);

      const historyEntry: RecognitionHistoryEntry = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        saleDate: summary.saleDate,
        totalItems: summary.totalItems,
        autoMatchedItems: summary.autoMatchedItems,
        reviewItems: summary.reviewItems,
        items: summary.previewItems.map((item) => ({
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalAmount: item.totalAmount,
          status: item.status
        }))
      };

      const nextHistory = [historyEntry, ...recognitionHistory].slice(0, RECOGNITION_HISTORY_LIMIT);
      persistRecognitionHistory(nextHistory);
    } catch (err: any) {
      console.error(err);
      const rawMessage = String(err?.message || err || '识别失败');
      const lower = rawMessage.toLowerCase();
      const message = lower.includes('did not match the expected pattern')
        ? '图片格式解析失败，请重拍或改用 JPG/PNG 图片'
        : lower.includes('ai_timeout')
          ? '云端识别超时，请减少单次上传图片数量后重试'
          : lower.includes('图片过大') || lower.includes('http 413')
            ? '图片体积过大，请重拍或压缩后再识别'
        : lower.includes('function_invocation_failed')
          ? '云端识别函数执行失败（可能超时或运行时异常），请稍后重试'
          : rawMessage;
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const exitPendingPreview = () => {
    setPendingAnalysis(null);
    setManualSelections({});
    setEditableProductNames({});
    setEditablePrices({});
    setSaleDateInput('');
  };

  const applyAutoMatchedSales = async () => {
    if (!pendingAnalysis) return;
    setApplyingAuto(true);
    try {
      const finalSaleDate = saleDateInput || pendingAnalysis.saleDate;

      // 遍历 previewItems，使用编辑后的价格
      for (let idx = 0; idx < pendingAnalysis.previewItems.length; idx++) {
        const item = pendingAnalysis.previewItems[idx];
        if (item.status !== 'auto' || !item.bestCandidate) continue;

        const editedPrice = editablePrices[idx];
        const finalUnitPrice = editedPrice ? (parseFloat(editedPrice.unitPrice) || 0) : item.unitPrice;
        const finalTotal = editedPrice ? (parseFloat(editedPrice.totalAmount) || 0) : item.totalAmount;
        const saleTotal = finalTotal > 0 ? finalTotal : finalUnitPrice * item.quantity;

        await addSale(
          item.bestCandidate.productId,
          item.quantity,
          salesperson,
          finalSaleDate || undefined,
          saleTotal > 0 ? saleTotal : undefined
        );
      }

      await store.fetchData?.();

      setReport({
        saleDate: finalSaleDate,
        totalItems: pendingAnalysis.totalItems,
        autoMatchedItems: pendingAnalysis.autoSales.length,
        manualMatchedItems: 0,
        reviewItems: pendingAnalysis.reviewItems
      });
      setPendingAnalysis(null);
    } catch (err: any) {
      setError(err?.message || '执行自动入账失败');
    } finally {
      setApplyingAuto(false);
    }
  };

  const applySelectedManualSales = async () => {
    if (!report) return;

    const selectedIndexes = Object.keys(manualSelections)
      .map(Number)
      .filter((index) => !!manualSelections[index]);

    if (selectedIndexes.length === 0) {
      setError('请先为待复核项选择目标商品');
      return;
    }

    setApplyingManual(true);
    setError(null);
    try {
      const finalSaleDate = saleDateInput || report.saleDate;
      for (const index of selectedIndexes) {
        const item = report.reviewItems[index];
        const productId = manualSelections[index];
        if (!item || !productId) continue;
        const itemTotal = item.totalAmount > 0 ? item.totalAmount : item.unitPrice * item.quantity;
        await addSale(productId, item.quantity, salesperson, finalSaleDate || undefined, itemTotal > 0 ? itemTotal : undefined);
      }

      const selectedSet = new Set(selectedIndexes);
      const remainingReview = report.reviewItems.filter((_, index) => !selectedSet.has(index));
      const nextSelections: Record<number, string> = {};
      remainingReview.forEach((item, index) => {
        if (item.bestCandidate) nextSelections[index] = item.bestCandidate.productId;
      });

      setManualSelections(nextSelections);
      setReport((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          saleDate: finalSaleDate,
          manualMatchedItems: prev.manualMatchedItems + selectedIndexes.length,
          reviewItems: remainingReview
        };
      });

      await store.fetchData?.();
    } catch (err: any) {
      setError(err?.message || '执行人工复核入账失败');
    } finally {
      setApplyingManual(false);
    }
  };

  const showMobileActions = !!pendingAnalysis || !!(report && report.reviewItems.length > 0);

  return (
    <div className={`p-3 sm:p-4 max-w-4xl mx-auto space-y-3 sm:space-y-4 ${showMobileActions ? 'pb-24 sm:pb-0' : ''}`}>
      {/* 顶部控制栏 */}
      <div className="bg-white p-4 sm:p-6 rounded-xl sm:rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 sm:gap-4">
        <div className="min-w-0">
          <h2 className="text-base sm:text-xl font-bold flex items-center gap-2">
            <Camera className="text-emerald-500 w-5 h-5" /> 手写小票识别
          </h2>
          <p className="text-slate-500 text-xs sm:text-sm mt-1">流程：高置信匹配 → 预览复核 → 执行入账</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[auto,1fr,1fr] gap-2 w-full md:w-auto">
          <span className="text-xs sm:text-sm font-medium text-slate-500 self-center">销售员:</span>
          <input
            type="text"
            value={salesperson}
            onChange={(e) => setSalesperson(e.target.value)}
            placeholder="输入销售员姓名"
            className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500 w-full min-w-0"
          />
          <input
            type="date"
            value={saleDateInput}
            onChange={(e) => setSaleDateInput(e.target.value)}
            className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500 w-full min-w-0"
            title="销售日期（可手动修正）"
          />
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl sm:rounded-2xl shadow-sm border border-slate-100">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-sm sm:text-base font-bold text-slate-900">识别历史（核对用）</h3>
          <button
            onClick={() => persistRecognitionHistory([])}
            className="px-2.5 py-1.5 text-xs font-bold bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-all"
          >
            清空历史
          </button>
        </div>

        {recognitionHistory.length === 0 ? (
          <div className="text-xs text-slate-400">暂无识别历史，执行一次识别后会自动记录。</div>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {recognitionHistory.map((entry) => (
              <details key={entry.id} className="border border-slate-200 rounded-lg bg-slate-50/60">
                <summary className="cursor-pointer list-none px-3 py-2.5 flex items-center justify-between gap-2 text-xs text-slate-700">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800 truncate">
                      {entry.saleDate || '未识别日期'} · 共 {entry.totalItems} 条
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {new Date(entry.createdAt).toLocaleString('zh-CN')}
                    </div>
                  </div>
                  <div className="shrink-0 text-[11px] text-slate-500">
                    自动 {entry.autoMatchedItems} / 待复核 {entry.reviewItems}
                  </div>
                </summary>
                <div className="px-3 pb-3 space-y-1.5">
                  {entry.items.map((item, index) => (
                    <div key={`${entry.id}_${index}`} className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-[11px] text-slate-600">
                      <div className="font-medium text-slate-800 break-words">{item.productName}</div>
                      <div>数量 {item.quantity} · 单价 ￥{item.unitPrice} · 金额 ￥{item.totalAmount}</div>
                      <div className={item.status === 'auto' ? 'text-emerald-600' : 'text-amber-600'}>
                        {item.status === 'auto' ? '自动匹配' : '待复核'}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {/* 左侧：上传预览 */}
        <div className="space-y-4">
          <div 
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-200 rounded-xl sm:rounded-2xl p-6 sm:p-8 text-center hover:bg-slate-50 cursor-pointer transition-all"
          >
            <input type="file" ref={fileInputRef} hidden multiple onChange={handleImageUpload} accept="image/*,.heic,.heif" />
            <Upload className="mx-auto w-10 h-10 text-slate-300 mb-2" />
            <span className="text-xs sm:text-sm text-slate-600">点击或拖拽上传发票</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {images.map((img, i) => (
              <div key={i} className="relative aspect-square rounded-lg overflow-hidden border">
                <img src={img} className="object-cover w-full h-full" />
                <button onClick={() => setImages(images.filter((_, idx) => idx !== i))} className="absolute top-1 right-1 bg-white rounded-full p-1.5 shadow"><X size={12}/></button>
              </div>
            ))}
          </div>

          {images.length > 0 && (
            <button 
              onClick={processImage} 
              disabled={loading || applyingAuto || applyingManual}
              className="w-full py-3.5 bg-emerald-500 text-white rounded-xl font-bold disabled:opacity-50 flex justify-center items-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin" /> : <CheckCircle size={20} />}
              {loading ? "AI 识别并匹配中..." : "开始识别并生成预览"}
            </button>
          )}
        </div>

        {/* 右侧：识别结果 */}
        <div className="bg-slate-50 rounded-xl sm:rounded-2xl p-3 sm:p-4 min-h-[260px] sm:min-h-[300px]">
          {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-xs flex items-center gap-2"><AlertCircle size={14}/>{error}</div>}

          {pendingAnalysis ? (
            <div className="space-y-3 border border-sky-100 bg-sky-50/60 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm font-bold text-sky-800">
                  识别预览（发票）
                </div>
                <div className="hidden sm:flex w-full sm:w-auto gap-2">
                  <button
                    onClick={exitPendingPreview}
                    disabled={applyingAuto}
                    className="flex-1 sm:flex-none px-3 py-2 rounded-lg bg-white text-slate-700 border border-slate-200 text-xs font-bold hover:bg-slate-50 disabled:opacity-50"
                  >
                    退出预览
                  </button>
                  <button
                    onClick={applyAutoMatchedSales}
                    disabled={applyingAuto}
                    className="flex-1 sm:flex-none px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50"
                  >
                    {applyingAuto ? '执行中...' : '确认执行自动入账'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="bg-white rounded-lg p-2 text-center">
                  <p className="text-[11px] text-slate-500">识别日期</p>
                  <p className="font-bold text-slate-800 truncate">{pendingAnalysis.saleDate || '未检测到'}</p>
                </div>
                <div className="bg-white rounded-lg p-2 text-center">
                  <p className="text-[11px] text-slate-500">总条目</p>
                  <p className="font-bold text-slate-800">{pendingAnalysis.totalItems}</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-2 text-center">
                  <p className="text-[11px] text-emerald-600">可自动入账</p>
                  <p className="font-bold text-emerald-700">{pendingAnalysis.autoSales.length}</p>
                </div>
                <div className="bg-amber-50 rounded-lg p-2 text-center">
                  <p className="text-[11px] text-amber-600">待人工复核</p>
                  <p className="font-bold text-amber-700">{pendingAnalysis.reviewItems.length}</p>
                </div>
              </div>

              <div className="max-h-[44dvh] sm:max-h-[400px] overflow-y-auto space-y-2 pr-0.5">
                {pendingAnalysis.previewItems.map((item, idx) => (
                  <div key={idx} className="bg-white rounded-lg border border-sky-100 p-2.5 text-xs">
                    <div className="font-medium text-slate-800 break-words">商品：</div>
                    <input
                      value={editableProductNames[idx] ?? item.productName}
                      onChange={(e) => setEditableProductNames((prev) => ({ ...prev, [idx]: e.target.value }))}
                      onBlur={() => applyEditedProductName(idx)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          applyEditedProductName(idx);
                        }
                      }}
                      className="mt-1 w-full px-2.5 py-2 border border-slate-200 rounded-md text-sm sm:text-xs"
                      placeholder="可编辑商品名，失焦后自动重新匹配"
                    />
                    <div className="text-slate-500 mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span>数量：{item.quantity}</span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-0.5">单价：￥
                        <input
                          type="number"
                          step="0.01"
                          value={editablePrices[idx]?.unitPrice ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditablePrices((prev) => {
                              const cur = prev[idx] || { unitPrice: '', totalAmount: '' };
                              const newUnitPrice = val;
                              const parsed = parseFloat(val);
                              const newTotal = Number.isFinite(parsed) ? String(+(parsed * item.quantity).toFixed(3)) : cur.totalAmount;
                              return { ...prev, [idx]: { unitPrice: newUnitPrice, totalAmount: newTotal } };
                            });
                          }}
                          className="w-16 px-1 py-0.5 border border-slate-200 rounded text-xs text-right"
                          placeholder="0"
                        />
                      </span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-0.5">金额：￥
                        <input
                          type="number"
                          step="0.01"
                          value={editablePrices[idx]?.totalAmount ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditablePrices((prev) => {
                              const cur = prev[idx] || { unitPrice: '', totalAmount: '' };
                              return { ...prev, [idx]: { ...cur, totalAmount: val } };
                            });
                          }}
                          className="w-20 px-1 py-0.5 border border-slate-200 rounded text-xs text-right"
                          placeholder="0"
                        />
                      </span>
                    </div>
                    {item.hasMathDiscrepancy && (
                      <div className="text-amber-600 mt-1">⚠️ 金额校验异常</div>
                    )}
                    <div className={`${item.status === 'auto' ? 'text-emerald-700' : 'text-amber-700'} mt-1`}>
                      {item.status === 'auto' ? '自动入账' : '待人工复核'}：{item.reason}
                    </div>
                    {item.bestCandidate && (
                      <div className="text-slate-500 break-words">匹配商品：{item.bestCandidate.productName}（匹配度 {(item.bestCandidate.score * 100).toFixed(1)}%）</div>
                    )}
                    <div className="mt-1">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${item.status === 'auto' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {item.status === 'auto' ? '自动入账' : '待人工复核'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : report ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <p className="text-[11px] text-slate-500">识别日期</p>
                  <p className="font-bold text-slate-800 truncate">{report.saleDate || '未检测到'}</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 text-center">
                  <p className="text-[11px] text-emerald-600">自动匹配</p>
                  <p className="font-bold text-emerald-700">{report.autoMatchedItems}</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <p className="text-[11px] text-blue-600">人工确认</p>
                  <p className="font-bold text-blue-700">{report.manualMatchedItems}</p>
                </div>
                <div className="bg-amber-50 rounded-lg p-3 text-center">
                  <p className="text-[11px] text-amber-600">待人工复核</p>
                  <p className="font-bold text-amber-700">{report.reviewItems.length}</p>
                </div>
              </div>

              {report.reviewItems.length === 0 ? (
                <div className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg p-3">
                  所有项目已处理完成。
                </div>
              ) : (
                <div className="border border-amber-100 bg-amber-50/60 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2 gap-2 flex-col sm:flex-row">
                    <div className="text-amber-700 text-sm font-bold">待人工复核 {report.reviewItems.length} 条</div>
                    <button
                      onClick={applySelectedManualSales}
                      disabled={applyingManual || selectedManualCount === 0}
                      className="hidden sm:block w-full sm:w-auto px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50"
                    >
                      {applyingManual ? '执行中...' : `执行已选复核项（${selectedManualCount}）`}
                    </button>
                  </div>
                  <div className="max-h-[44dvh] sm:max-h-[380px] overflow-y-auto space-y-2 pr-0.5">
                    {report.reviewItems.map((item, idx) => (
                      <div key={idx} className="bg-white rounded-lg border border-amber-100 p-2.5 text-xs">
                        <div className="font-medium text-slate-800 break-words">商品：{item.productName}</div>
                        <div className="text-slate-500 mt-0.5">数量：{item.quantity} · 单价：￥{item.unitPrice} · 金额：￥{item.totalAmount}</div>
                        <div className="text-[11px] text-amber-600 mt-1">{item.reason}</div>
                        <div className="mt-2 text-[10px] text-slate-500">
                          {item.bestCandidate
                            ? `最佳候选：${item.bestCandidate.productName}（${(item.bestCandidate.score * 100).toFixed(1)}%）`
                            : '暂无候选，请手动选择'}
                        </div>
                        <select
                          value={manualSelections[idx] || ''}
                          onChange={(e) => setManualSelections((prev) => ({ ...prev, [idx]: e.target.value }))}
                          className="mt-2 w-full px-2.5 py-2.5 border border-slate-200 rounded-lg text-sm"
                        >
                          <option value="">请选择匹配商品</option>
                          {productIndex.map((product: any) => (
                            <option key={product.id} value={product.id}>{product.name}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  setReport(null);
                  setManualSelections({});
                  setEditableProductNames({});
                  setEditablePrices({});
                  setSaleDateInput('');
                  setImages([]);
                }}
                className="w-full py-2.5 bg-white text-slate-700 border border-slate-200 rounded-xl font-bold"
              >
                完成并重置
              </button>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm italic">
              <p>{loading ? "AI 正在分析，请稍候..." : "暂无识别结果"}</p>
            </div>
          )}
        </div>
      </div>

      {showMobileActions && (
        <div className="sm:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-slate-100 bg-white/95 backdrop-blur-md p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {pendingAnalysis ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={exitPendingPreview}
                className="px-3 py-2.5 rounded-lg bg-white text-slate-700 border border-slate-200 text-xs font-bold"
              >
                退出预览
              </button>
              <button
                onClick={applyAutoMatchedSales}
                disabled={applyingAuto}
                className="px-3 py-2.5 rounded-lg bg-slate-900 text-white text-xs font-bold disabled:opacity-50"
              >
                {applyingAuto ? '执行中...' : '确认执行自动入账'}
              </button>
            </div>
          ) : (
            <button
              onClick={applySelectedManualSales}
              disabled={applyingManual || selectedManualCount === 0}
              className="w-full px-3 py-2.5 rounded-lg bg-slate-900 text-white text-xs font-bold disabled:opacity-50"
            >
              {applyingManual ? '应用中...' : `应用已选择项(${selectedManualCount})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}