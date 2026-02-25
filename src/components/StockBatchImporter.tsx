import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { FileSpreadsheet, Loader2, X, AlertTriangle, CheckCircle2, ImageUp } from 'lucide-react';

interface StockBatchImporterProps {
  store?: any;
}

type ParsedRow = {
  model: string;
  qty: number;
  rowIndex: number;
};

type MatchCandidate = {
  productId: string;
  productName: string;
  score: number;
};

type UnmatchedItem = {
  model: string;
  qty: number;
  reason: string;
  rowIndex?: number;
  bestCandidate?: MatchCandidate;
};

type ImportReport = {
  totalRows: number;
  parsedRows: number;
  autoMatchedRows: number;
  manualMatchedRows: number;
  updatedProducts: number;
  totalAddedQty: number;
  unmatched: UnmatchedItem[];
};

type PreviewItem = {
  model: string;
  qty: number;
  rowIndex: number;
  reason: string;
  status: 'auto' | 'review';
  bestCandidate?: MatchCandidate;
};

type PendingAnalysis = {
  source: 'excel' | 'image';
  totalRows: number;
  parsedRows: number;
  unmatched: UnmatchedItem[];
  autoIncrements: Array<{ productId: string; productName: string; qty: number }>;
  previewItems: PreviewItem[];
};

const MODEL_KEYS = ['型号', '商品型号', '商品名称', '名称', 'model', 'Model'];
const QTY_KEYS = ['数量', '库存数量', '补货数量', 'qty', 'Qty', 'QTY'];
const AUTO_MATCH_SCORE = 0.88;
const AMBIGUOUS_GAP = 0.08;

const normalizeModel = (value: string) =>
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
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
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

const scoreModelSimilarity = (source: string, target: string) => {
  const sourceNormalized = normalizeModel(source);
  const targetNormalized = normalizeModel(target);

  if (!sourceNormalized || !targetNormalized) return 0;
  if (sourceNormalized === targetNormalized) return 1;

  if (
    sourceNormalized.includes(targetNormalized) ||
    targetNormalized.includes(sourceNormalized)
  ) {
    return 0.92;
  }

  const maxLen = Math.max(sourceNormalized.length, targetNormalized.length);
  const editScore = maxLen === 0 ? 0 : 1 - levenshteinDistance(sourceNormalized, targetNormalized) / maxLen;

  const tokenScore = jaccardSimilarity(tokenize(source), tokenize(target));
  const finalScore = editScore * 0.65 + tokenScore * 0.35;
  return Math.max(0, Math.min(1, finalScore));
};

const pickCellValue = (row: Record<string, any>, keys: string[]) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return row[key];
    }
  }
  return '';
};

const parseRows = (rawRows: any[]): ParsedRow[] => {
  const parsed: ParsedRow[] = [];

  rawRows.forEach((row, index) => {
    const modelRaw = pickCellValue(row, MODEL_KEYS);
    const qtyRaw = pickCellValue(row, QTY_KEYS);

    const model = String(modelRaw || '').trim();
    const qty = Number(qtyRaw);

    if (!model || !Number.isFinite(qty) || qty <= 0) return;

    parsed.push({ model, qty, rowIndex: index + 2 });
  });

  return parsed;
};

const fileToDataUrl = (file: File) => {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (evt) => resolve(String(evt.target?.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
};

const compressImageDataUrl = (dataUrl: string) => {
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxWidth = 1400;
      let { width, height } = img;

      if (width > maxWidth) {
        height = Math.round(height * (maxWidth / width));
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas 初始化失败'));

      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => reject(new Error('图片压缩失败'));
  });
};

const exportReviewList = (
  rows: UnmatchedItem[],
  fileNamePrefix: string,
  selectedMap?: Record<number, string>,
  products?: Array<{ id: string; name: string }>
) => {
  if (!rows.length) {
    alert('当前没有可导出的复核数据');
    return;
  }

  const productNameById = new Map<string, string>();
  (products || []).forEach((item) => productNameById.set(item.id, item.name));

  const exportRows = rows.map((item, index) => {
    const selectedProductId = selectedMap?.[index] || '';
    return {
      行号: item.rowIndex || '',
      型号: item.model,
      数量: item.qty,
      原因: item.reason,
      最佳候选商品: item.bestCandidate?.productName || '',
      最佳候选匹配度: item.bestCandidate ? `${(item.bestCandidate.score * 100).toFixed(1)}%` : '',
      人工已选商品: selectedProductId ? (productNameById.get(selectedProductId) || '') : ''
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(exportRows);
  XLSX.utils.book_append_sheet(wb, ws, '复核清单');

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');

  XLSX.writeFile(wb, `${fileNamePrefix}_${yyyy}${mm}${dd}_${hh}${mi}.xlsx`);
};

export function StockBatchImporter({ store }: StockBatchImporterProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [applyingManual, setApplyingManual] = useState(false);
  const [applyingAuto, setApplyingAuto] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pendingAnalysis, setPendingAnalysis] = useState<PendingAnalysis | null>(null);
  const [manualSelections, setManualSelections] = useState<Record<number, string>>({});
  const [reviewFilter, setReviewFilter] = useState<'all' | 'selected' | 'unselected'>('all');

  const products = store?.products || [];
  const updateProduct = store?.updateProduct;
  const fetchData = store?.fetchData;

  const productIndex = useMemo(() => {
    return products.map((p: any) => ({ id: p.id, name: p.name, stock: Number(p.stock) || 0 }));
  }, [products]);

  const filteredReviewItems = useMemo(() => {
    if (!report) return [] as Array<UnmatchedItem & { originalIndex: number }>;

    const withIndex = report.unmatched.map((item, originalIndex) => ({ ...item, originalIndex }));
    if (reviewFilter === 'selected') {
      return withIndex.filter(item => !!manualSelections[item.originalIndex]);
    }
    if (reviewFilter === 'unselected') {
      return withIndex.filter(item => !manualSelections[item.originalIndex]);
    }
    return withIndex;
  }, [report, reviewFilter, manualSelections]);

  const onPickFile = () => fileInputRef.current?.click();
  const onPickImages = () => imageInputRef.current?.click();

  const applyParsedRows = async (parsedRows: ParsedRow[], totalRows: number, source: 'excel' | 'image') => {
    const unmatched: UnmatchedItem[] = [];
    const incrementsByProduct = new Map<string, { productName: string; qty: number; rows: number }>();
    const previewItems: PreviewItem[] = [];

    for (const row of parsedRows) {
      const ranked = productIndex
        .map((product: any) => ({
          productId: product.id,
          productName: product.name,
          score: scoreModelSimilarity(row.model, product.name)
        }))
        .sort((a: MatchCandidate, b: MatchCandidate) => b.score - a.score);

      const best = ranked[0];
      const second = ranked[1];

      if (!best || best.score < AUTO_MATCH_SCORE) {
        const unmatchedItem = {
          model: row.model,
          qty: row.qty,
          rowIndex: row.rowIndex,
          reason: '匹配分低于阈值',
          bestCandidate: best
        };
        unmatched.push(unmatchedItem);
        previewItems.push({
          ...unmatchedItem,
          status: 'review'
        });
        continue;
      }

      if (second && best.score - second.score < AMBIGUOUS_GAP) {
        const unmatchedItem = {
          model: row.model,
          qty: row.qty,
          rowIndex: row.rowIndex,
          reason: '存在多个相近型号，匹配不够唯一',
          bestCandidate: best
        };
        unmatched.push(unmatchedItem);
        previewItems.push({
          ...unmatchedItem,
          status: 'review'
        });
        continue;
      }

      previewItems.push({
        model: row.model,
        qty: row.qty,
        rowIndex: row.rowIndex,
        reason: '高置信度且匹配唯一',
        status: 'auto',
        bestCandidate: best
      });

      const prev = incrementsByProduct.get(best.productId);
      if (prev) {
        prev.qty += row.qty;
        prev.rows += 1;
      } else {
        incrementsByProduct.set(best.productId, {
          productName: best.productName,
          qty: row.qty,
          rows: 1
        });
      }
    }

    const nextSelections: Record<number, string> = {};
    unmatched.forEach((item, index) => {
      if (item.bestCandidate) {
        nextSelections[index] = item.bestCandidate.productId;
      }
    });
    setManualSelections(nextSelections);

    const autoIncrements = Array.from(incrementsByProduct.entries()).map(([productId, increment]) => ({
      productId,
      productName: increment.productName,
      qty: increment.qty
    }));

    setPendingAnalysis({
      source,
      totalRows,
      parsedRows: parsedRows.length,
      unmatched,
      autoIncrements,
      previewItems
    });
    setReport(null);
  };

  const applyAutoMatchedRows = async () => {
    if (!pendingAnalysis || !updateProduct) return;

    setApplyingAuto(true);
    try {
      const productStockMap = new Map<string, number>();
      (store?.products || []).forEach((product: any) => {
        productStockMap.set(product.id, Number(product.stock) || 0);
      });

      let updatedProducts = 0;
      let totalAddedQty = 0;

      for (const increment of pendingAnalysis.autoIncrements) {
        const current = productStockMap.get(increment.productId);
        if (current === undefined) continue;

        const ok = await updateProduct(increment.productId, { stock: current + increment.qty });
        if (ok) {
          updatedProducts += 1;
          totalAddedQty += increment.qty;
          productStockMap.set(increment.productId, current + increment.qty);
        }
      }

      await fetchData?.();

      setReport({
        totalRows: pendingAnalysis.totalRows,
        parsedRows: pendingAnalysis.parsedRows,
        autoMatchedRows: pendingAnalysis.parsedRows - pendingAnalysis.unmatched.length,
        manualMatchedRows: 0,
        updatedProducts,
        totalAddedQty,
        unmatched: pendingAnalysis.unmatched
      });
      setPendingAnalysis(null);
    } finally {
      setApplyingAuto(false);
    }
  };

  const processFile = async (file: File) => {
    if (!updateProduct) {
      alert('库存更新功能未就绪');
      return;
    }

    setProcessing(true);
    setReport(null);
    setPendingAnalysis(null);
    setReviewFilter('all');

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(ws);

      const parsedRows = parseRows(rawRows);
      await applyParsedRows(parsedRows, rawRows.length, 'excel');
    } catch (error) {
      console.error('Batch stock import failed:', error);
      alert('批量补库存失败，请检查 Excel 格式（需包含：型号/商品名称 + 数量）');
    } finally {
      setProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const processImages = async (files: File[]) => {
    if (!updateProduct) {
      alert('库存更新功能未就绪');
      return;
    }

    if (files.length === 0) return;

    setProcessing(true);
    setReport(null);
    setPendingAnalysis(null);
    setReviewFilter('all');

    try {
      const parsedRows: ParsedRow[] = [];
      let rowCounter = 1;

      for (const file of files) {
        const dataUrl = await fileToDataUrl(file);
        const compressed = await compressImageDataUrl(dataUrl);

        const response = await fetch('/api/analyze-stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64Data: compressed, mimeType: file.type || 'image/jpeg' })
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || '图片识别失败');
        }

        const items = Array.isArray(payload?.items) ? payload.items : [];
        items.forEach((item: any) => {
          const model = String(item?.model || item?.productModel || item?.productName || '').trim();
          const qty = Number(item?.quantity ?? item?.qty ?? 0);
          if (!model || !Number.isFinite(qty) || qty <= 0) return;
          parsedRows.push({ model, qty, rowIndex: rowCounter++ });
        });
      }

      if (parsedRows.length === 0) {
        alert('未从图片中识别到有效的“型号 + 数量”数据');
        return;
      }

      await applyParsedRows(parsedRows, parsedRows.length, 'image');
    } catch (error) {
      console.error('Image stock recognition failed:', error);
      alert('图片识别入库失败，请检查图片清晰度或稍后重试');
    } finally {
      setProcessing(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const applySelectedManualMatches = async () => {
    if (!report || !updateProduct) return;

    const selectedIndexes = Object.keys(manualSelections)
      .map(Number)
      .filter((index) => !!manualSelections[index]);

    if (selectedIndexes.length === 0) {
      alert('请先为待复核项选择目标商品');
      return;
    }

    setApplyingManual(true);
    try {
      const productStockMap = new Map<string, number>();
      (store?.products || []).forEach((product: any) => {
        productStockMap.set(product.id, Number(product.stock) || 0);
      });

      const incrementsByProduct = new Map<string, number>();
      selectedIndexes.forEach((index) => {
        const item = report.unmatched[index];
        const productId = manualSelections[index];
        if (!item || !productId) return;
        incrementsByProduct.set(productId, (incrementsByProduct.get(productId) || 0) + item.qty);
      });

      let updatedProducts = 0;
      let totalAddedQty = 0;

      for (const [productId, qty] of incrementsByProduct.entries()) {
        const currentStock = productStockMap.get(productId);
        if (currentStock === undefined) continue;
        const ok = await updateProduct(productId, { stock: currentStock + qty });
        if (ok) {
          updatedProducts += 1;
          totalAddedQty += qty;
        }
      }

      const selectedSet = new Set(selectedIndexes);
      const remainingUnmatched = report.unmatched.filter((_, index) => !selectedSet.has(index));
      const remainingSelections: Record<number, string> = {};
      remainingUnmatched.forEach((item, index) => {
        if (item.bestCandidate) {
          remainingSelections[index] = item.bestCandidate.productId;
        }
      });

      setManualSelections(remainingSelections);
      setReport((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          manualMatchedRows: prev.manualMatchedRows + selectedIndexes.length,
          updatedProducts: prev.updatedProducts + updatedProducts,
          totalAddedQty: prev.totalAddedQty + totalAddedQty,
          unmatched: remainingUnmatched
        };
      });

      await fetchData?.();
    } finally {
      setApplyingManual(false);
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          processFile(file);
        }}
      />

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length === 0) return;
          processImages(files);
        }}
      />

      <button
        onClick={() => setOpen(true)}
        className="w-full sm:w-auto px-4 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-xl font-bold transition-all flex items-center justify-center gap-2 border border-emerald-100 shadow-sm text-sm"
      >
        <FileSpreadsheet className="w-4 h-4" />
        批量补库存
      </button>

      {open && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[120] flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl border border-slate-100 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 flex items-start justify-between gap-3 sticky top-0 bg-white z-10">
              <div className="min-w-0">
                <h3 className="text-base sm:text-lg font-bold text-slate-900">批量补库存（智能匹配）</h3>
                <p className="text-[11px] sm:text-xs text-slate-500 mt-1">仅自动更新高置信度型号；低置信度将保留在复核列表，不自动写入</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-2.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto">
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center sticky top-0 sm:top-auto bg-white/95 backdrop-blur-sm z-[5] pb-1">
                <button
                  onClick={onPickFile}
                  disabled={processing}
                  className="w-full sm:w-auto px-4 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                  {processing ? '识别中...' : '选择 Excel 生成预览'}
                </button>
                <button
                  onClick={onPickImages}
                  disabled={processing}
                  className="w-full sm:w-auto px-4 py-3 bg-indigo-50 text-indigo-700 rounded-xl text-sm font-bold hover:bg-indigo-100 disabled:opacity-60 flex items-center justify-center gap-2 border border-indigo-100"
                >
                  <ImageUp className="w-4 h-4" />
                  上传图片识别生成预览
                </button>
                <span className="text-[11px] sm:text-xs text-slate-500">支持列名：型号/商品名称 + 数量</span>
              </div>

              {pendingAnalysis && (
                <div className="space-y-3 border border-sky-100 bg-sky-50/60 rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-sm font-bold text-sky-800">
                      识别预览（来源：{pendingAnalysis.source === 'excel' ? 'Excel' : '图片'}）
                    </div>
                    <div className="w-full sm:w-auto flex gap-2">
                      <button
                        onClick={() => exportReviewList(pendingAnalysis.unmatched, '复核清单_预览')}
                        className="flex-1 sm:flex-none px-3 py-2 rounded-lg bg-white text-slate-700 border border-slate-200 text-xs font-bold hover:bg-slate-50"
                      >
                        导出复核清单
                      </button>
                      <button
                        onClick={applyAutoMatchedRows}
                        disabled={applyingAuto}
                        className="flex-1 sm:flex-none px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50"
                      >
                        {applyingAuto ? '执行中...' : '确认执行自动入库'}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="bg-white rounded-lg p-2 text-center">
                      <p className="text-[11px] text-slate-500">总行数</p>
                      <p className="font-bold text-slate-800">{pendingAnalysis.totalRows}</p>
                    </div>
                    <div className="bg-white rounded-lg p-2 text-center">
                      <p className="text-[11px] text-slate-500">有效行</p>
                      <p className="font-bold text-slate-800">{pendingAnalysis.parsedRows}</p>
                    </div>
                    <div className="bg-emerald-50 rounded-lg p-2 text-center">
                      <p className="text-[11px] text-emerald-600">可自动入库</p>
                      <p className="font-bold text-emerald-700">{pendingAnalysis.parsedRows - pendingAnalysis.unmatched.length}</p>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-2 text-center">
                      <p className="text-[11px] text-amber-600">待人工复核</p>
                      <p className="font-bold text-amber-700">{pendingAnalysis.unmatched.length}</p>
                    </div>
                  </div>

                  <div className="max-h-56 overflow-y-auto space-y-2 pr-0.5">
                    {pendingAnalysis.previewItems.map((item, index) => (
                      <div key={`${item.model}-${item.rowIndex}-${index}`} className="bg-white rounded-lg border border-sky-100 p-2.5 text-xs">
                        <div className="font-medium text-slate-800 break-words">型号：{item.model} · 数量：{item.qty} · 行号：{item.rowIndex}</div>
                        <div className={`${item.status === 'auto' ? 'text-emerald-700' : 'text-amber-700'}`}>
                          {item.status === 'auto' ? '自动入库' : '待复核'}：{item.reason}
                        </div>
                        {item.bestCandidate && (
                          <div className="text-slate-500 break-words">
                            匹配商品：{item.bestCandidate.productName}（匹配度 {(item.bestCandidate.score * 100).toFixed(1)}%）
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {report && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                      <p className="text-[11px] text-slate-500">总行数</p>
                      <p className="font-bold text-slate-800">{report.totalRows}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                      <p className="text-[11px] text-slate-500">有效行</p>
                      <p className="font-bold text-slate-800">{report.parsedRows}</p>
                    </div>
                    <div className="bg-emerald-50 rounded-lg p-3 text-center">
                      <p className="text-[11px] text-emerald-600">自动匹配行</p>
                      <p className="font-bold text-emerald-700">{report.autoMatchedRows}</p>
                    </div>
                    <div className="bg-indigo-50 rounded-lg p-3 text-center">
                      <p className="text-[11px] text-indigo-600">更新商品数</p>
                      <p className="font-bold text-indigo-700">{report.updatedProducts}</p>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-3 text-center">
                      <p className="text-[11px] text-blue-600">人工确认行</p>
                      <p className="font-bold text-blue-700">{report.manualMatchedRows}</p>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-3 text-center">
                      <p className="text-[11px] text-amber-600">累计增加库存</p>
                      <p className="font-bold text-amber-700">{report.totalAddedQty}</p>
                    </div>
                  </div>

                  {report.unmatched.length > 0 && (
                    <div className="border border-amber-100 bg-amber-50/60 rounded-xl p-3">
                      <div className="flex items-center gap-2 text-amber-700 text-sm font-bold mb-2">
                        <AlertTriangle className="w-4 h-4" />
                        待人工复核 {report.unmatched.length} 条（未自动入库）
                      </div>
                      <div className="flex items-stretch sm:items-center justify-between mb-2 gap-2 flex-col sm:flex-row">
                        <div className="flex items-center gap-1 bg-white border border-amber-200 rounded-lg p-1 text-xs overflow-x-auto">
                          <button
                            onClick={() => setReviewFilter('all')}
                            className={`px-2 py-1 rounded shrink-0 whitespace-nowrap ${reviewFilter === 'all' ? 'bg-amber-100 text-amber-700 font-bold' : 'text-slate-600'}`}
                          >
                            全部（{report.unmatched.length}）
                          </button>
                          <button
                            onClick={() => setReviewFilter('unselected')}
                            className={`px-2 py-1 rounded shrink-0 whitespace-nowrap ${reviewFilter === 'unselected' ? 'bg-amber-100 text-amber-700 font-bold' : 'text-slate-600'}`}
                          >
                            未选择（{report.unmatched.filter((_, i) => !manualSelections[i]).length}）
                          </button>
                          <button
                            onClick={() => setReviewFilter('selected')}
                            className={`px-2 py-1 rounded shrink-0 whitespace-nowrap ${reviewFilter === 'selected' ? 'bg-amber-100 text-amber-700 font-bold' : 'text-slate-600'}`}
                          >
                            已选择（{report.unmatched.filter((_, i) => !!manualSelections[i]).length}）
                          </button>
                        </div>
                        <div className="w-full sm:w-auto flex gap-2">
                          <button
                            onClick={() => exportReviewList(report.unmatched, '复核清单_人工复核', manualSelections, productIndex)}
                            className="flex-1 sm:flex-none px-3 py-2 rounded-lg bg-white text-slate-700 border border-slate-200 text-xs font-bold hover:bg-slate-50"
                          >
                            导出复核清单
                          </button>
                          <button
                            onClick={applySelectedManualMatches}
                            disabled={applyingManual}
                            className="flex-1 sm:flex-none px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50"
                          >
                            {applyingManual ? '应用中...' : '应用已选择项'}
                          </button>
                        </div>
                      </div>
                      <div className="max-h-[42vh] sm:max-h-56 overflow-y-auto space-y-2 pr-0.5">
                        {filteredReviewItems.map((item) => (
                          <div key={`${item.model}-${item.originalIndex}`} className="bg-white rounded-lg border border-amber-100 p-2.5 text-xs">
                            <div className="font-medium text-slate-800 break-words">型号：{item.model} · 数量：{item.qty}{item.rowIndex ? ` · 行号：${item.rowIndex}` : ''}</div>
                            <div className="text-amber-700">原因：{item.reason}</div>
                            {item.bestCandidate && (
                              <div className="text-slate-500 break-words">最佳候选：{item.bestCandidate.productName}（匹配度 {(item.bestCandidate.score * 100).toFixed(1)}%）</div>
                            )}
                            <div className="mt-2">
                              <select
                                value={manualSelections[item.originalIndex] || ''}
                                onChange={(e) => setManualSelections(prev => ({ ...prev, [item.originalIndex]: e.target.value }))}
                                className="w-full px-2 py-2.5 border border-slate-200 rounded-md text-xs"
                              >
                                <option value="">请选择入库商品</option>
                                {productIndex.map((product: any) => (
                                  <option key={`${item.originalIndex}-${product.id}`} value={product.id}>
                                    {product.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        ))}
                        {filteredReviewItems.length === 0 && (
                          <div className="text-xs text-slate-500 bg-white rounded-lg border border-amber-100 p-3 text-center">
                            当前筛选下暂无数据
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {report.unmatched.length === 0 && (report.autoMatchedRows > 0 || report.manualMatchedRows > 0) && (
                    <div className="flex items-center gap-2 text-emerald-700 text-sm font-bold bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                      <CheckCircle2 className="w-4 h-4" />
                      本次有效数据已全部完成入库（自动匹配 + 人工确认）
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
