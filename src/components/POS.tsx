import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  DollarSign,
  Package,
  Plus,
  Search,
  ShoppingBag,
  Sparkles,
  Tag,
  User,
} from 'lucide-react';
import { useStore } from '../hooks/useStore';
import { formatZhDateTime } from '../lib/date';
import { buildHistoricalPriceMap, getReferencePrice } from '../lib/pricing';
import { appendStoreActivity, clearStoreActivity, listStoreActivity } from '../lib/storeActivity';
import { FeedbackToast, type FeedbackMessage } from './common/FeedbackToast';
import { ReadonlyNotice } from './ReadonlyNotice';

type PosEntryRecord = {
  id: string;
  inputOrder: number;
  createdAt: string;
  productName: string;
  quantity: number;
  saleUnitPrice: number;
  totalAmount: number;
  salesperson: string;
  saleDate?: string;
  isNewProduct: boolean;
  costPrice?: number;
  inventoryInput?: number;
  abnormalPriceNote?: string;
};

type MatchSuggestion = {
  id: string;
  name: string;
  score: number;
  costPrice?: number;
  stock: number;
  price: number;
  categoryId?: string;
};

type BatchDraft = {
  id: string;
  lineIndex: number;
  rawLine: string;
  keyword: string;
  quantity: number;
  unitPriceText: string;
  matchedProduct: MatchSuggestion | null;
  suggestions: MatchSuggestion[];
  score: number;
  referencePrice: number;
  totalAmount: number;
  isNewProduct: boolean;
  needsAbnormalNote: boolean;
  error?: string;
};

const POS_ENTRY_RECORDS_LIMIT = 120;
const AUTO_MATCH_THRESHOLD = 0.7;
const SUGGESTION_THRESHOLD = 0.45;

const normalizeModel = (value: string) =>
  value
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
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
};

const scoreModelSimilarity = (source: string, target: string) => {
  const sourceNormalized = normalizeModel(source);
  const targetNormalized = normalizeModel(target);
  if (!sourceNormalized || !targetNormalized) return 0;
  if (sourceNormalized === targetNormalized) return 1;
  if (sourceNormalized.includes(targetNormalized) || targetNormalized.includes(sourceNormalized)) return 0.92;
  const maxLen = Math.max(sourceNormalized.length, targetNormalized.length);
  return maxLen === 0 ? 0 : Math.max(0, 1 - levenshteinDistance(sourceNormalized, targetNormalized) / maxLen);
};

const formatMoney = (value?: number | string | null) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  return amount.toFixed(2);
};

const formatMoneyInput = (value?: string | number | null) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return raw;
  return amount.toFixed(2);
};

const isNumeric = (value: string) => /^-?\d+(?:\.\d+)?$/.test(value);
const isIntegerText = (value: string) => /^\d+$/.test(value);

const parseBatchLine = (line: string) => {
  const text = String(line || '').trim();
  if (!text) return null;

  const commaParts = text.split(/[，,]/).map((part) => part.trim()).filter(Boolean);
  if (commaParts.length >= 2) {
    return {
      keyword: commaParts[0],
      quantityText: commaParts[1],
      unitPriceText: commaParts[2] || '',
    };
  }

  const timesPattern = text.match(/^(.*?)[xX＊*]\s*(\d+)(?:\s+(-?\d+(?:\.\d+)?))?$/);
  if (timesPattern) {
    return {
      keyword: timesPattern[1].trim(),
      quantityText: timesPattern[2],
      unitPriceText: timesPattern[3] || '',
    };
  }

  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length >= 3 && isIntegerText(parts[parts.length - 2]) && isNumeric(parts[parts.length - 1])) {
    return {
      keyword: parts.slice(0, -2).join(' '),
      quantityText: parts[parts.length - 2],
      unitPriceText: parts[parts.length - 1],
    };
  }

  if (parts.length >= 2 && isIntegerText(parts[parts.length - 1])) {
    return {
      keyword: parts.slice(0, -1).join(' '),
      quantityText: parts[parts.length - 1],
      unitPriceText: '',
    };
  }

  return {
    keyword: text,
    quantityText: '1',
    unitPriceText: '',
  };
};

const composeBatchLine = (keyword: string, quantity: number, unitPriceText?: string) => {
  const normalizedKeyword = String(keyword || '').trim();
  const normalizedPrice = String(unitPriceText || '').trim();
  if (!normalizedKeyword) return '';
  return normalizedPrice
    ? `${normalizedKeyword}, ${quantity}, ${normalizedPrice}`
    : `${normalizedKeyword}, ${quantity}`;
};

const normalizePosEntryRecord = (
  payload: any,
  fallback: { id: string; createdAt: string }
): PosEntryRecord | null => {
  if (!payload || typeof payload !== 'object') return null;

  const productName = String(payload.productName || '').trim();
  const salesperson = String(payload.salesperson || '').trim();
  const quantity = Number(payload.quantity || 0);
  const saleUnitPrice = Number(payload.saleUnitPrice || 0);
  const totalAmount = Number(payload.totalAmount || 0);
  const inputOrder = Number(payload.inputOrder || 0);
  const createdAt = String(payload.createdAt || fallback.createdAt || '').trim() || new Date().toISOString();

  if (!productName || !salesperson || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(inputOrder) || inputOrder <= 0) {
    return null;
  }

  return {
    id: String(payload.id || fallback.id),
    inputOrder,
    createdAt,
    productName,
    quantity,
    saleUnitPrice: Number.isFinite(saleUnitPrice) ? saleUnitPrice : 0,
    totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0,
    salesperson,
    saleDate: payload.saleDate ? String(payload.saleDate) : undefined,
    isNewProduct: !!payload.isNewProduct,
    costPrice: Number.isFinite(Number(payload.costPrice)) ? Number(payload.costPrice) : undefined,
    inventoryInput: Number.isFinite(Number(payload.inventoryInput)) ? Number(payload.inventoryInput) : undefined,
    abnormalPriceNote: payload.abnormalPriceNote ? String(payload.abnormalPriceNote) : undefined,
  };
};

export function POS({ store, storeId, canEdit = false }: { store: ReturnType<typeof useStore>; storeId?: string; canEdit?: boolean }) {
  const { products, categories, sales, addSale, addProduct } = store;
  const [entryMode, setEntryMode] = useState<'single' | 'batch'>('batch');
  const [searchTerm, setSearchTerm] = useState('');
  const [batchInput, setBatchInput] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [salesperson, setSalesperson] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [manualPrice, setManualPrice] = useState('');
  const [abnormalPriceNote, setAbnormalPriceNote] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [initStock, setInitStock] = useState('');
  const [saleDate, setSaleDate] = useState('');
  const [entryRecords, setEntryRecords] = useState<PosEntryRecord[]>([]);
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);
  const [resolvedProductId, setResolvedProductId] = useState<string | null>(null);
  const [batchAbnormalPriceNote, setBatchAbnormalPriceNote] = useState('');

  useEffect(() => {
    let active = true;

    const loadEntryRecords = async () => {
      if (!storeId) {
        if (active) setEntryRecords([]);
        return;
      }

      const rows = await listStoreActivity<PosEntryRecord>(storeId, 'pos_entry', POS_ENTRY_RECORDS_LIMIT, (row) =>
        normalizePosEntryRecord(row.payload, {
          id: row.id,
          createdAt: row.sort_time || row.created_at || new Date().toISOString(),
        })
      );

      if (active) {
        setEntryRecords(rows.reverse());
      }
    };

    void loadEntryRecords();

    return () => {
      active = false;
    };
  }, [storeId]);

  const appendEntryRecords = async (nextRecords: PosEntryRecord[]) => {
    if (!nextRecords.length) return;
    setEntryRecords((prev) => [...prev, ...nextRecords].slice(-POS_ENTRY_RECORDS_LIMIT));
    if (!storeId) return;
    await appendStoreActivity(
      storeId,
      'pos_entry',
      nextRecords.map((record) => ({
        id: record.id,
        sortTime: record.createdAt,
        payload: record,
      }))
    );
  };

  const clearEntryRecords = async () => {
    setEntryRecords([]);
    await clearStoreActivity(storeId, 'pos_entry');
  };

  const buildMatchResult = (text: string) => {
    const keyword = String(text || '').trim();
    if (!keyword) {
      return { matchedProduct: null as MatchSuggestion | null, score: 0, suggestions: [] as MatchSuggestion[] };
    }

    const ranked = products
      .map((product) => ({
        id: product.id,
        name: String(product.name || ''),
        score: scoreModelSimilarity(keyword, String(product.name || '')),
        costPrice: product.cost_price,
        stock: Number(product.stock) || 0,
        price: Number(product.price) || 0,
        categoryId: product.category_id,
      }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0] || null;
    const suggestions = ranked.filter((item) => item.score >= SUGGESTION_THRESHOLD).slice(0, 3);

    return {
      matchedProduct: best && best.score >= AUTO_MATCH_THRESHOLD ? best : null,
      score: best?.score || 0,
      suggestions,
    };
  };

  const autoMatch = useMemo(() => {
    return buildMatchResult(searchTerm);
  }, [products, searchTerm]);

  const matchedProduct = autoMatch.matchedProduct;
  const isNewProduct = searchTerm.trim().length > 0 && !matchedProduct;
  const historicalPriceMap = useMemo(() => buildHistoricalPriceMap(sales), [sales]);

  const getSuggestedPrice = (product: MatchSuggestion | null) => {
    if (!product) return 0;
    const historicalPrice = historicalPriceMap.get(product.id);
    const reference = getReferencePrice({
      product: {
        id: product.id,
        name: product.name,
        price: product.price,
        stock: product.stock,
        cost_price: product.costPrice,
      },
      historicalPrice,
    });
    return reference > 0 ? reference : product.price;
  };

  const hasHistoricalReference = useMemo(() => {
    if (!matchedProduct || isNewProduct) return false;
    return (historicalPriceMap.get(matchedProduct.id) || 0) > 0;
  }, [historicalPriceMap, isNewProduct, matchedProduct]);

  const referencePrice = useMemo(() => {
    if (!matchedProduct || isNewProduct) return 0;
    return getSuggestedPrice(matchedProduct);
  }, [historicalPriceMap, isNewProduct, matchedProduct]);

  const priceDeviation = useMemo(() => {
    if (!matchedProduct || isNewProduct) return 0;
    const basePrice = referencePrice;
    const salePrice = parseFloat(manualPrice);
    if (!Number.isFinite(basePrice) || basePrice <= 0) return 0;
    if (!Number.isFinite(salePrice) || salePrice <= 0) return 0;
    return Math.abs(salePrice - basePrice) / basePrice;
  }, [isNewProduct, manualPrice, matchedProduct, referencePrice]);

  const needsAbnormalNote = !!matchedProduct && !isNewProduct && hasHistoricalReference && priceDeviation >= 0.3;

  useEffect(() => {
    if (matchedProduct) {
      if (resolvedProductId !== matchedProduct.id) {
        const suggestedPrice = referencePrice > 0 ? referencePrice : matchedProduct.price;
        setManualPrice(suggestedPrice > 0 ? formatMoney(suggestedPrice) : '');
        setSelectedCategoryId(matchedProduct.categoryId || '');
      }
      setCostPrice(formatMoney(matchedProduct.costPrice ?? matchedProduct.price));
      setResolvedProductId(matchedProduct.id);
      return;
    }

    if (resolvedProductId) {
      setManualPrice('');
      setCostPrice('');
      setSelectedCategoryId('');
      setResolvedProductId(null);
    }
  }, [matchedProduct, referencePrice, resolvedProductId]);

  const subtotal = useMemo(() => {
    const price = parseFloat(manualPrice);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0) return 0;
    return Number((price * quantity).toFixed(2));
  }, [manualPrice, quantity]);

  const batchDrafts = useMemo(() => {
    return batchInput
      .split(/\r?\n/)
      .map((rawLine, index) => ({ rawLine, index }))
      .filter(({ rawLine }) => rawLine.trim().length > 0)
      .map(({ rawLine, index }) => {
        const parsed = parseBatchLine(rawLine);
        if (!parsed || !parsed.keyword.trim()) {
          return {
            id: `batch-${index}`,
            lineIndex: index,
            rawLine,
            keyword: '',
            quantity: 0,
            unitPriceText: '',
            matchedProduct: null,
            suggestions: [],
            score: 0,
            referencePrice: 0,
            totalAmount: 0,
            isNewProduct: false,
            needsAbnormalNote: false,
            error: '这一行没有识别到商品名。',
          } satisfies BatchDraft;
        }

        const parsedQuantity = Number.parseInt(parsed.quantityText, 10);
        const quantityValue = Number.isInteger(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 0;
        const unitPriceText = formatMoneyInput(parsed.unitPriceText);
        const match = buildMatchResult(parsed.keyword);
        const matched = match.matchedProduct;
        const suggestedPrice = matched ? getSuggestedPrice(matched) : 0;
        const finalUnitPriceText = unitPriceText || (suggestedPrice > 0 ? formatMoneyInput(suggestedPrice) : '');
        const unitPrice = Number(finalUnitPriceText);
        const deviation = matched && suggestedPrice > 0 && Number.isFinite(unitPrice) && unitPrice > 0
          ? Math.abs(unitPrice - suggestedPrice) / suggestedPrice
          : 0;

        let error = '';
        if (!quantityValue) error = '数量必须是大于 0 的整数。';
        if (!matched) error = error || '还没有匹配到商品，请点候选或调整名称。';
        if (finalUnitPriceText && (!Number.isFinite(unitPrice) || unitPrice <= 0)) error = error || '单价格式不正确。';

        return {
          id: `batch-${index}`,
          lineIndex: index,
          rawLine,
          keyword: parsed.keyword.trim(),
          quantity: quantityValue || 1,
          unitPriceText: finalUnitPriceText,
          matchedProduct: matched,
          suggestions: match.suggestions,
          score: match.score,
          referencePrice: suggestedPrice,
          totalAmount: Number.isFinite(unitPrice) && unitPrice > 0 ? Number((unitPrice * (quantityValue || 1)).toFixed(2)) : 0,
          isNewProduct: parsed.keyword.trim().length > 0 && !matched,
          needsAbnormalNote: !!matched && suggestedPrice > 0 && deviation >= 0.3,
          error: error || undefined,
        } satisfies BatchDraft;
      });
  }, [batchInput, buildMatchResult, getSuggestedPrice]);

  const batchSummary = useMemo(() => {
    const totalLines = batchDrafts.length;
    const matchedCount = batchDrafts.filter((item) => item.matchedProduct).length;
    const unmatchedCount = batchDrafts.filter((item) => !item.matchedProduct).length;
    const invalidCount = batchDrafts.filter((item) => !!item.error).length;
    const abnormalCount = batchDrafts.filter((item) => item.needsAbnormalNote).length;
    const totalQuantity = batchDrafts.reduce((sum, item) => sum + (Number.isFinite(item.quantity) ? item.quantity : 0), 0);
    const totalAmount = batchDrafts.reduce((sum, item) => sum + item.totalAmount, 0);
    const hasAbnormalPrice = batchDrafts.some((item) => item.needsAbnormalNote);
    const readyCount = Math.max(0, totalLines - invalidCount);
    return { totalLines, matchedCount, unmatchedCount, invalidCount, abnormalCount, totalQuantity, readyCount, totalAmount, hasAbnormalPrice };
  }, [batchDrafts]);

  const handleApplySuggestion = (suggestion: MatchSuggestion) => {
    setSearchTerm(suggestion.name);
  };

  const updateBatchLine = (lineIndex: number, nextKeyword: string, nextQuantity: number, nextUnitPriceText: string) => {
    const nextLines = batchInput.split(/\r?\n/);
    nextLines[lineIndex] = composeBatchLine(nextKeyword, Math.max(1, nextQuantity), nextUnitPriceText);
    setBatchInput(nextLines.join('\n'));
  };

  const handleApplyBatchSuggestion = (draft: BatchDraft, suggestion: MatchSuggestion) => {
    updateBatchLine(draft.lineIndex, suggestion.name, draft.quantity, draft.unitPriceText);
  };

  const handleBatchKeywordChange = (draft: BatchDraft, nextKeyword: string) => {
    updateBatchLine(draft.lineIndex, nextKeyword, draft.quantity, draft.unitPriceText);
  };

  const handleAdjustBatchQuantity = (draft: BatchDraft, delta: number) => {
    updateBatchLine(draft.lineIndex, draft.keyword, Math.max(1, draft.quantity + delta), draft.unitPriceText);
  };

  const handleBatchPriceChange = (draft: BatchDraft, nextValue: string) => {
    updateBatchLine(draft.lineIndex, draft.keyword, draft.quantity, nextValue);
  };

  const handleApplyBatchReferencePrice = (draft: BatchDraft) => {
    if (draft.referencePrice <= 0) return;
    updateBatchLine(draft.lineIndex, draft.keyword, draft.quantity, formatMoneyInput(draft.referencePrice));
  };

  const handleAdjustQuantity = (delta: number) => {
    setQuantity((prev) => Math.max(1, prev + delta));
  };

  const resetForm = () => {
    setSearchTerm('');
    setQuantity(1);
    setManualPrice('');
    setAbnormalPriceNote('');
    setCostPrice('');
    setInitStock('');
    setSelectedCategoryId('');
    setResolvedProductId(null);
  };

  const resetBatchForm = () => {
    setBatchInput('');
    setBatchAbnormalPriceNote('');
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();

    const salespersonName = salesperson.trim();
    const normalizedSearchTerm = searchTerm.trim();

    if (!salespersonName) {
      setFeedback({ type: 'error', text: '请填写销售人员姓名。' });
      return;
    }

    if (!normalizedSearchTerm) {
      setFeedback({ type: 'error', text: '请输入商品名称或型号。' });
      return;
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      setFeedback({ type: 'error', text: '数量必须大于 0。' });
      return;
    }

    if (!manualPrice || parseFloat(manualPrice) <= 0) {
      setFeedback({ type: 'error', text: '请输入有效的销售单价。' });
      return;
    }

    if (needsAbnormalNote && !abnormalPriceNote.trim()) {
      setFeedback({ type: 'error', text: '当前售价与参考价偏差较大，请先填写异常备注。' });
      return;
    }

    setIsSubmitting(true);
    try {
      let finalProductId = matchedProduct?.id;
      const salePrice = parseFloat(manualPrice);

      if (matchedProduct && !isNewProduct) {
        const currentStock = Number(matchedProduct.stock) || 0;
        if (quantity > currentStock) {
          const confirmed = window.confirm(`当前库存 ${currentStock}，本次销售数量 ${quantity}，将形成负库存，确认继续吗？`);
          if (!confirmed) {
            setIsSubmitting(false);
            return;
          }
        }
      }

      if (isNewProduct) {
        const newCostPrice = parseFloat(costPrice) || 0;
        const newInitStock = parseInt(initStock, 10) || 0;

        if (!addProduct) {
          throw new Error('当前门店未加载新增商品能力');
        }

        if (newCostPrice <= 0) {
          setFeedback({ type: 'error', text: '新商品需要填写有效成本价。' });
          setIsSubmitting(false);
          return;
        }

        const { data: newProduct, error } = await addProduct({
          name: normalizedSearchTerm,
          price: salePrice,
          stock: newInitStock,
          category_id: selectedCategoryId || undefined,
          cost_price: newCostPrice,
        });

        if (error || !newProduct?.id) {
          throw new Error(error?.message || '创建新商品失败');
        }

        finalProductId = newProduct.id;
      }

      if (!finalProductId) {
        throw new Error('无法确定商品 ID');
      }

      const overrideTotal = salePrice > 0 ? Number((salePrice * quantity).toFixed(2)) : undefined;
      const success = await addSale(finalProductId, quantity, salespersonName, saleDate || undefined, overrideTotal);

      if (!success) {
        setFeedback({ type: 'error', text: '销售提交失败，请稍后重试。' });
        return;
      }

      const lastOrder = entryRecords.length ? entryRecords[entryRecords.length - 1].inputOrder : 0;
      const record: PosEntryRecord = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        inputOrder: lastOrder + 1,
        createdAt: new Date().toISOString(),
        productName: matchedProduct?.name || normalizedSearchTerm,
        quantity,
        saleUnitPrice: salePrice,
        totalAmount: Number((salePrice * quantity).toFixed(2)),
        salesperson: salespersonName,
        saleDate: saleDate || undefined,
        isNewProduct,
        costPrice: isNewProduct ? (parseFloat(costPrice) || 0) : undefined,
        inventoryInput: isNewProduct ? (parseInt(initStock, 10) || 0) : undefined,
        abnormalPriceNote: needsAbnormalNote ? abnormalPriceNote.trim() : undefined,
      };

      await appendEntryRecords([record]);
      setFeedback({
        type: 'success',
        text: isNewProduct
          ? `已自动创建“${normalizedSearchTerm}”并完成销售录入。`
          : `已自动匹配“${matchedProduct?.name || normalizedSearchTerm}”并完成销售录入。`,
      });
      resetForm();
    } catch (error) {
      console.error('Checkout error:', error);
      setFeedback({ type: 'error', text: '提交过程中发生错误，请重试。' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBatchCheckout = async () => {
    const salespersonName = salesperson.trim();

    if (!salespersonName) {
      setFeedback({ type: 'error', text: '请先填写销售人员姓名。' });
      return;
    }

    if (batchDrafts.length === 0) {
      setFeedback({ type: 'error', text: '请先粘贴批量商品清单。' });
      return;
    }

    const invalidDraft = batchDrafts.find((item) => item.error);
    if (invalidDraft) {
      setFeedback({ type: 'error', text: `第 ${invalidDraft.lineIndex + 1} 行还没准备好：${invalidDraft.error}` });
      return;
    }

    if (batchSummary.hasAbnormalPrice && !batchAbnormalPriceNote.trim()) {
      setFeedback({ type: 'error', text: '批量清单里存在偏差较大的售价，请先填写异常备注。' });
      return;
    }

    const requiredByProduct = new Map<string, { name: string; stock: number; required: number }>();
    batchDrafts.forEach((item) => {
      if (!item.matchedProduct) return;
      const current = requiredByProduct.get(item.matchedProduct.id);
      if (current) {
        current.required += item.quantity;
        return;
      }
      requiredByProduct.set(item.matchedProduct.id, {
        name: item.matchedProduct.name,
        stock: item.matchedProduct.stock,
        required: item.quantity,
      });
    });

    const shortages = Array.from(requiredByProduct.values()).filter((item) => item.required > item.stock);
    if (shortages.length > 0) {
      const preview = shortages.slice(0, 3).map((item) => `${item.name}（库存 ${item.stock} / 录入 ${item.required}）`).join('、');
      const confirmed = window.confirm(`以下商品会形成负库存：${preview}${shortages.length > 3 ? ' 等' : ''}。确认继续批量录入吗？`);
      if (!confirmed) return;
    }

    setIsSubmitting(true);
    try {
      const lastOrder = entryRecords.length ? entryRecords[entryRecords.length - 1].inputOrder : 0;
      const newRecords: PosEntryRecord[] = [];

      for (let index = 0; index < batchDrafts.length; index += 1) {
        const draft = batchDrafts[index];
        if (!draft.matchedProduct) {
          throw new Error(`第 ${draft.lineIndex + 1} 行未匹配到商品`);
        }

        const salePrice = Number(draft.unitPriceText);
        const overrideTotal = Number((salePrice * draft.quantity).toFixed(2));
        const success = await addSale(
          draft.matchedProduct.id,
          draft.quantity,
          salespersonName,
          saleDate || undefined,
          overrideTotal
        );

        if (!success) {
          throw new Error(`第 ${draft.lineIndex + 1} 行提交失败`);
        }

        newRecords.push({
          id: `${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
          inputOrder: lastOrder + index + 1,
          createdAt: new Date().toISOString(),
          productName: draft.matchedProduct.name,
          quantity: draft.quantity,
          saleUnitPrice: salePrice,
          totalAmount: overrideTotal,
          salesperson: salespersonName,
          saleDate: saleDate || undefined,
          isNewProduct: false,
          abnormalPriceNote: draft.needsAbnormalNote ? batchAbnormalPriceNote.trim() : undefined,
        });
      }

      await appendEntryRecords(newRecords);
      setFeedback({
        type: 'success',
        text: `已批量录入 ${newRecords.length} 条商品，总金额 ￥${newRecords.reduce((sum, item) => sum + item.totalAmount, 0).toFixed(2)}。`,
      });
      resetBatchForm();
    } catch (error) {
      console.error('Batch checkout error:', error);
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : '批量录入失败，请重试。' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitForm = (event: React.FormEvent) => {
    if (entryMode === 'batch') {
      event.preventDefault();
      return;
    }
    void handleCheckout(event);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <FeedbackToast message={feedback} onClose={() => setFeedback(null)} />
      {!canEdit && <ReadonlyNotice description="收银终端可查看当前商品信息，但只有管理员可以提交销售和自动创建新商品。" />}

      <section className="ui-card overflow-hidden">
        <div className="bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_38%),linear-gradient(135deg,#ffffff_0%,#f8fafc_100%)] border-b border-slate-100 p-6 sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 border border-emerald-100">
                <Sparkles className="w-3.5 h-3.5" />
                自动模糊匹配商品
              </div>
              <div>
                <h2 className="flex items-center gap-2 text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
                  <ShoppingBag className="w-7 h-7 text-emerald-500" />
                  收银终端
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  现在支持手动批量输入清单并逐行自动匹配；单条录入保留在下方，适合少量补录。
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-100 bg-white/85 px-4 py-3 shadow-sm">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-bold">商品数</div>
                <div className="mt-1 text-xl font-black text-slate-900">{products.length}</div>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-white/85 px-4 py-3 shadow-sm">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-bold">历史价参考</div>
                <div className="mt-1 text-xl font-black text-slate-900">{sales.length}</div>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-white/85 px-4 py-3 shadow-sm col-span-2 sm:col-span-1">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-bold">本机记录</div>
                <div className="mt-1 text-xl font-black text-slate-900">{entryRecords.length}</div>
              </div>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmitForm} className="p-5 sm:p-6 space-y-6">
          <fieldset disabled={!canEdit} className="contents disabled:opacity-60">
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.95fr)] gap-6">
              <div className="space-y-6">
                <div className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.96),rgba(255,255,255,1))] p-4 sm:p-5 shadow-sm">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                        POS Workflow
                      </div>
                      <h3 className="mt-3 text-lg font-black text-slate-900">
                        {entryMode === 'batch' ? '批量录入工作台' : '单条录入工作台'}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        {entryMode === 'batch'
                          ? '先粘贴清单，再在预览区逐行微调商品名、数量和单价，最后一次性结算。'
                          : '适合零散补录，左侧找商品，右侧直接核价和结算。'}
                      </p>
                    </div>

                    <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-100 p-1 self-start">
                      <button
                        type="button"
                        onClick={() => setEntryMode('batch')}
                        className={`rounded-2xl px-4 py-2 text-sm font-bold transition-all ${
                          entryMode === 'batch'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        批量录入
                      </button>
                      <button
                        type="button"
                        onClick={() => setEntryMode('single')}
                        className={`rounded-2xl px-4 py-2 text-sm font-bold transition-all ${
                          entryMode === 'single'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        单条录入
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <User className="w-4 h-4" />
                        销售人员
                      </label>
                      <input
                        type="text"
                        value={salesperson}
                        onChange={(e) => setSalesperson(e.target.value)}
                        placeholder="输入经手人姓名"
                        className="ui-input !bg-white"
                        required
                      />
                    </div>

                    <div>
                      <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <CalendarDays className="w-4 h-4" />
                        销售日期
                      </label>
                      <input
                        type="date"
                        value={saleDate}
                        onChange={(e) => setSaleDate(e.target.value)}
                        className="ui-input !bg-white"
                        title="不填则默认使用当前时间"
                      />
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">当前模式</div>
                      <div className="mt-1 text-sm font-black text-slate-900">{entryMode === 'batch' ? '批量录入' : '单条录入'}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">人员状态</div>
                      <div className={`mt-1 text-sm font-black ${salesperson.trim() ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {salesperson.trim() ? '已填写' : '待填写'}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                        {entryMode === 'batch' ? '待处理行' : '商品状态'}
                      </div>
                      <div className="mt-1 text-sm font-black text-slate-900">
                        {entryMode === 'batch'
                          ? `${batchSummary.invalidCount} 行未完成`
                          : matchedProduct
                            ? '已自动匹配'
                            : isNewProduct
                              ? '新商品录入'
                              : '等待输入'}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                        {entryMode === 'batch' ? '总件数' : '结算预估'}
                      </div>
                      <div className="mt-1 text-sm font-black text-slate-900">
                        {entryMode === 'batch' ? `${batchSummary.totalQuantity} 件` : `￥${subtotal.toFixed(2)}`}
                      </div>
                    </div>
                  </div>
                </div>

                {entryMode === 'single' && (
                <>
                <div className={`rounded-3xl border p-4 sm:p-5 transition-all ${
                  matchedProduct
                    ? 'border-emerald-200 bg-emerald-50/60'
                    : isNewProduct
                      ? 'border-amber-200 bg-amber-50/70'
                      : 'border-slate-200 bg-slate-50/60'
                }`}>
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Search className="w-4 h-4" />
                    商品名称或型号
                  </label>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="例如：A4纸、佳能墨盒、蓝牙鼠标"
                    className="ui-input !bg-white"
                    required
                  />

                  {!searchTerm.trim() && (
                    <p className="mt-3 text-xs text-slate-500">
                      系统会像调货功能一样自动模糊匹配当前库存中的商品。
                    </p>
                  )}

                  {matchedProduct && (
                    <div className="mt-4 rounded-2xl border border-emerald-200 bg-white/90 p-4 shadow-sm">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">
                            自动匹配成功
                            <span>{Math.round(autoMatch.score * 100)}%</span>
                          </div>
                          <h3 className="mt-3 text-xl font-black text-slate-900">{matchedProduct.name}</h3>
                          <p className="mt-1 text-sm text-slate-500">
                            已自动使用最接近的库存商品，无需手动精确选择。
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-2 min-w-[220px]">
                          <div className="rounded-2xl bg-slate-50 px-3 py-3">
                            <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">库存</div>
                            <div className={`mt-1 font-mono text-lg font-black ${matchedProduct.stock < 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                              {matchedProduct.stock}
                            </div>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-3 py-3">
                            <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">成本价</div>
                            <div className="mt-1 font-mono text-lg font-black text-slate-900">
                              ￥{formatMoney(matchedProduct.costPrice ?? matchedProduct.price)}
                            </div>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-3 py-3 col-span-2">
                            <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">参考售价</div>
                            <div className="mt-1 font-mono text-lg font-black text-slate-900">
                              ￥{formatMoney(referencePrice || matchedProduct.price)}
                            </div>
                          </div>
                        </div>
                      </div>

                      {autoMatch.suggestions.length > 1 && (
                        <div className="mt-4">
                          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">其他候选</p>
                          <div className="flex flex-wrap gap-2">
                            {autoMatch.suggestions
                              .filter((item) => item.id !== matchedProduct.id)
                              .map((item) => (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => handleApplySuggestion(item)}
                                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                                >
                                  {item.name} · {Math.round(item.score * 100)}%
                                </button>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {isNewProduct && (
                    <div className="mt-4 rounded-2xl border border-amber-200 bg-white/90 p-4 shadow-sm">
                      <div className="flex items-start gap-3">
                        <div className="rounded-2xl bg-amber-100 p-2 text-amber-700">
                          <Plus className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-lg font-black text-slate-900">未匹配到现有商品</h3>
                          <p className="mt-1 text-sm text-slate-600">
                            系统会把“{searchTerm.trim()}”按新商品处理，并在提交时自动入库。
                          </p>
                          {autoMatch.suggestions.length > 0 && (
                            <div className="mt-3">
                              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">接近候选</p>
                              <div className="flex flex-wrap gap-2">
                                {autoMatch.suggestions.map((item) => (
                                  <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => handleApplySuggestion(item)}
                                    className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                                  >
                                    改用 {item.name} · {Math.round(item.score * 100)}%
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {isNewProduct && (
                  <div className="rounded-3xl border border-amber-100 bg-amber-50/60 p-4 sm:p-5 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-amber-700">
                      <Tag className="w-4 h-4" />
                      新商品入库信息
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-700">成本价</label>
                        <input
                          type="number"
                          step="0.01"
                          value={costPrice}
                          onChange={(e) => setCostPrice(e.target.value)}
                          onBlur={(e) => setCostPrice(formatMoneyInput(e.target.value))}
                          className="ui-input !bg-white"
                          placeholder="必填"
                          required
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-700">初始库存</label>
                        <input
                          type="number"
                          min="0"
                          value={initStock}
                          onChange={(e) => setInitStock(e.target.value)}
                          className="ui-input !bg-white"
                          placeholder="默认 0"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <Tag className="w-4 h-4" />
                        商品分类
                      </label>
                      <select
                        value={selectedCategoryId}
                        onChange={(e) => setSelectedCategoryId(e.target.value)}
                        className="ui-select !bg-white"
                      >
                        <option value="">未分类</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>{category.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                </>
                )}
              </div>

              {entryMode === 'single' && (
              <div className="space-y-4 xl:sticky xl:top-4 self-start">
                <div className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm space-y-5">
                  <div>
                    <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <DollarSign className="w-4 h-4" />
                      销售单价
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={manualPrice}
                      onChange={(e) => setManualPrice(e.target.value)}
                      onBlur={(e) => setManualPrice(formatMoneyInput(e.target.value))}
                      className="ui-input"
                      placeholder="自动带入参考价，也可手动覆盖"
                      required
                    />
                    {matchedProduct && (
                      <p className="mt-2 text-xs text-slate-500">
                        当前参考售价：￥{formatMoney(referencePrice || matchedProduct.price)}
                      </p>
                    )}
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <label className="text-sm font-semibold text-slate-700">销售数量</label>
                      <div className="flex gap-2">
                        {[1, 2, 5, 10].map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setQuantity(value)}
                            className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                              quantity === value
                                ? 'bg-slate-900 text-white'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleAdjustQuantity(-1)}
                        className="h-11 w-11 rounded-2xl border border-slate-200 bg-slate-50 text-lg font-black text-slate-700 hover:bg-slate-100"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min="1"
                        value={quantity}
                        onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="ui-input text-center text-lg font-black"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => handleAdjustQuantity(1)}
                        className="h-11 w-11 rounded-2xl border border-slate-200 bg-slate-50 text-lg font-black text-slate-700 hover:bg-slate-100"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">商品状态</span>
                      <span className={`font-bold ${
                        matchedProduct ? 'text-emerald-600' : isNewProduct ? 'text-amber-600' : 'text-slate-400'
                      }`}>
                        {matchedProduct ? '已自动匹配' : isNewProduct ? '新商品录入' : '等待输入'}
                      </span>
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-4">
                      <div>
                        <div className="text-xs uppercase tracking-widest text-slate-400 font-bold">小计</div>
                        <div className="mt-1 text-3xl font-black text-slate-900">￥{subtotal.toFixed(2)}</div>
                      </div>
                      <div className="text-right text-xs text-slate-500">
                        <div>{matchedProduct ? matchedProduct.name : searchTerm.trim() || '未选择商品'}</div>
                        <div className="mt-1">数量 {quantity} · 单价 ￥{formatMoney(manualPrice || 0)}</div>
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting || !searchTerm.trim()}
                    className={`ui-btn w-full py-4 text-lg shadow-sm ${
                      isSubmitting ? 'bg-slate-200 text-slate-400' : 'ui-btn-primary'
                    }`}
                  >
                    {isSubmitting ? '处理中...' : (
                      <>
                        <CheckCircle2 className="w-5 h-5" />
                        完成并录入结算
                      </>
                    )}
                  </button>
                </div>

                {needsAbnormalNote && (
                  <div className="rounded-3xl border border-rose-200 bg-rose-50/70 p-4 sm:p-5 space-y-3">
                    <div className="flex items-start gap-2 text-rose-700">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      <div>
                        <div className="font-bold">售价偏差较大</div>
                        <div className="mt-1 text-sm">
                          当前售价与参考价偏差 {Math.round(priceDeviation * 100)}%，请补充备注后再提交。
                        </div>
                      </div>
                    </div>
                    <textarea
                      value={abnormalPriceNote}
                      onChange={(e) => setAbnormalPriceNote(e.target.value)}
                      rows={3}
                      placeholder="例如：活动折扣、临期清仓、批发价、内部价等"
                      className="ui-input !border-rose-200 !bg-white !text-sm"
                    />
                  </div>
                )}
              </div>
              )}

              {entryMode === 'batch' && (
                <>
                  <div className="space-y-4">
                    <div className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.9),rgba(255,255,255,1))] p-4 sm:p-5 shadow-sm">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <h3 className="text-lg font-black text-slate-900">批量商品清单</h3>
                          <p className="mt-1 text-sm text-slate-500">
                            一行一个商品，全部手动输入即可。推荐格式：`商品名, 数量` 或 `商品名, 数量, 单价`
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">按 Enter 分行</span>
                          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">预览区可直接改商品名</span>
                          <button
                            type="button"
                            onClick={resetBatchForm}
                            className="ui-btn-muted !px-3 !py-2 !rounded-xl text-xs"
                          >
                            清空清单
                          </button>
                        </div>
                      </div>

                      <textarea
                        value={batchInput}
                        onChange={(e) => setBatchInput(e.target.value)}
                        rows={8}
                        className="ui-input mt-4 !min-h-[240px] !bg-white !text-sm leading-6 shadow-inner"
                        placeholder={`A4纸, 2\n佳能墨盒, 1, 85\n蓝牙鼠标 x3`}
                      />

                      <div className="mt-4 grid gap-3 text-xs text-slate-500 sm:grid-cols-3">
                        <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                          <div className="font-bold text-slate-700">格式 1</div>
                          <div className="mt-1 font-mono text-slate-500">A4纸, 2</div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                          <div className="font-bold text-slate-700">格式 2</div>
                          <div className="mt-1 font-mono text-slate-500">佳能墨盒, 1, 85</div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                          <div className="font-bold text-slate-700">格式 3</div>
                          <div className="mt-1 font-mono text-slate-500">蓝牙鼠标 x3</div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[28px] border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-black text-slate-900">批量预览</h3>
                          <p className="mt-1 text-sm text-slate-500">先核对匹配结果，再一次性提交会更顺手。</p>
                        </div>
                        <div className="text-xs text-slate-400">{batchSummary.totalLines} 行</div>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">已就绪</div>
                          <div className="mt-1 text-lg font-black text-slate-900">{batchSummary.readyCount}</div>
                        </div>
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3">
                          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-rose-500">待处理</div>
                          <div className="mt-1 text-lg font-black text-rose-700">{batchSummary.invalidCount}</div>
                        </div>
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3">
                          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-500">总件数</div>
                          <div className="mt-1 text-lg font-black text-emerald-700">{batchSummary.totalQuantity}</div>
                        </div>
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3">
                          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-500">价格偏差</div>
                          <div className="mt-1 text-lg font-black text-amber-700">{batchSummary.abnormalCount}</div>
                        </div>
                      </div>

                      {batchDrafts.length === 0 ? (
                        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-400">
                          粘贴商品清单后，这里会自动生成匹配预览。
                        </div>
                      ) : (
                        <div className="mt-4 space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                          {batchDrafts.map((draft) => (
                            <div
                              key={draft.id}
                              className={`rounded-2xl border p-4 ${
                                draft.matchedProduct
                                  ? draft.error
                                    ? 'border-amber-200 bg-amber-50/60'
                                    : 'border-emerald-200 bg-emerald-50/50'
                                  : 'border-rose-200 bg-rose-50/50'
                              }`}
                            >
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">第 {draft.lineIndex + 1} 行</div>
                                  <div className="mt-1 text-base font-black text-slate-900">{draft.matchedProduct?.name || draft.keyword}</div>
                                  <div className="mt-1 text-xs text-slate-500">原始内容：{draft.rawLine}</div>
                                </div>
                                <div className="flex items-center gap-2 text-xs">
                                  <span className={`rounded-full px-2.5 py-1 font-bold ${
                                    draft.matchedProduct ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                                  }`}>
                                    {draft.matchedProduct ? `匹配 ${Math.round(draft.score * 100)}%` : '未匹配'}
                                  </span>
                                  {draft.needsAbnormalNote && (
                                    <span className="rounded-full bg-amber-100 px-2.5 py-1 font-bold text-amber-700">
                                      价格偏差
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_0.7fr_0.8fr]">
                                <div className="space-y-3 rounded-2xl bg-white/80 px-3 py-3 border border-white/60">
                                  <div>
                                    <label className="mb-1 block text-xs font-semibold text-slate-500">商品名</label>
                                    <input
                                      type="text"
                                      value={draft.keyword}
                                      onChange={(e) => handleBatchKeywordChange(draft, e.target.value)}
                                      className="ui-input !bg-white !h-10"
                                      placeholder="直接改这一行商品名"
                                    />
                                  </div>
                                  <div className="text-sm text-slate-700">
                                    {draft.matchedProduct
                                      ? `库存 ${draft.matchedProduct.stock} · 参考价 ￥${formatMoney(draft.referencePrice)}`
                                      : '可以直接改商品名，或点下方候选快速替换'}
                                  </div>
                                  {!!draft.error && (
                                    <div className="text-xs font-semibold text-rose-600">{draft.error}</div>
                                  )}
                                </div>

                                <div>
                                  <label className="mb-1 block text-xs font-semibold text-slate-500">数量</label>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleAdjustBatchQuantity(draft, -1)}
                                      className="h-10 w-10 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                    >
                                      -1
                                    </button>
                                    <div className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-center text-sm font-black text-slate-900">
                                      {draft.quantity}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleAdjustBatchQuantity(draft, 1)}
                                      className="h-10 w-10 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                    >
                                      +1
                                    </button>
                                  </div>
                                  <div className="mt-2 flex gap-2">
                                    {[1, 5, 10].map((step) => (
                                      <button
                                        key={step}
                                        type="button"
                                        onClick={() => handleAdjustBatchQuantity(draft, step)}
                                        className="flex-1 rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                                      >
                                        +{step}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                <div>
                                  <label className="mb-1 block text-xs font-semibold text-slate-500">单价</label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={draft.unitPriceText}
                                    onChange={(e) => handleBatchPriceChange(draft, e.target.value)}
                                    onBlur={(e) => handleBatchPriceChange(draft, formatMoneyInput(e.target.value))}
                                    className="ui-input !bg-white !h-10"
                                    placeholder="自动带入"
                                  />
                                  <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                                    <span>小计 ￥{draft.totalAmount.toFixed(2)}</span>
                                    <button
                                      type="button"
                                      onClick={() => handleApplyBatchReferencePrice(draft)}
                                      disabled={draft.referencePrice <= 0}
                                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-600 disabled:text-slate-300"
                                    >
                                      用参考价
                                    </button>
                                  </div>
                                </div>
                              </div>

                              {draft.suggestions.length > 0 && !draft.matchedProduct && (
                                <div className="mt-3">
                                  <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">接近候选</div>
                                  <div className="flex flex-wrap gap-2">
                                    {draft.suggestions.map((item) => (
                                      <button
                                        key={`${draft.id}-${item.id}`}
                                        type="button"
                                        onClick={() => handleApplyBatchSuggestion(draft, item)}
                                        className="rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                                      >
                                        改用 {item.name} · {Math.round(item.score * 100)}%
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4 xl:sticky xl:top-4 self-start">
                    <div className="rounded-[28px] border border-slate-200 bg-white p-4 sm:p-5 shadow-sm space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-black text-slate-900">批量结算摘要</h3>
                          <p className="mt-1 text-sm text-slate-500">右侧固定显示关键状态，录入时不用来回滚动。</p>
                        </div>
                        <Package className="w-5 h-5 text-emerald-500" />
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="font-semibold text-slate-500">当前状态</span>
                          <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                            batchSummary.invalidCount === 0 && batchSummary.totalLines > 0
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}>
                            {batchSummary.invalidCount === 0 && batchSummary.totalLines > 0 ? '可以直接提交' : '还有内容待确认'}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-500">
                          <div>
                            <div>销售人员</div>
                            <div className="mt-1 font-bold text-slate-900">{salesperson.trim() || '未填写'}</div>
                          </div>
                          <div>
                            <div>销售日期</div>
                            <div className="mt-1 font-bold text-slate-900">{saleDate || '按当前时间'}</div>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-2xl bg-slate-50 px-4 py-3">
                          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">总行数</div>
                          <div className="mt-1 text-2xl font-black text-slate-900">{batchSummary.totalLines}</div>
                        </div>
                        <div className="rounded-2xl bg-emerald-50 px-4 py-3">
                          <div className="text-[11px] uppercase tracking-wider text-emerald-600/70 font-bold">已匹配</div>
                          <div className="mt-1 text-2xl font-black text-emerald-700">{batchSummary.matchedCount}</div>
                        </div>
                        <div className="rounded-2xl bg-rose-50 px-4 py-3">
                          <div className="text-[11px] uppercase tracking-wider text-rose-600/70 font-bold">未完成</div>
                          <div className="mt-1 text-2xl font-black text-rose-700">{batchSummary.invalidCount}</div>
                        </div>
                        <div className="rounded-2xl bg-slate-900 px-4 py-3">
                          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">总金额</div>
                          <div className="mt-1 text-2xl font-black text-white">￥{batchSummary.totalAmount.toFixed(2)}</div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-500">本次预计录入</span>
                          <span className="font-black text-slate-900">{batchSummary.totalQuantity} 件</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-sm">
                          <span className="text-slate-500">需人工确认</span>
                          <span className={`font-black ${batchSummary.invalidCount > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                            {batchSummary.invalidCount} 行
                          </span>
                        </div>
                      </div>

                      {batchSummary.hasAbnormalPrice && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 space-y-2">
                          <div className="flex items-start gap-2 text-amber-700">
                            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                            <div className="text-sm">
                              批量清单里有售价与参考价偏差较大的行，请补充统一备注。
                            </div>
                          </div>
                          <textarea
                            value={batchAbnormalPriceNote}
                            onChange={(e) => setBatchAbnormalPriceNote(e.target.value)}
                            rows={3}
                            placeholder="例如：团购价、活动价、一次性清货等"
                            className="ui-input !bg-white !text-sm"
                          />
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={handleBatchCheckout}
                        disabled={isSubmitting || batchSummary.totalLines === 0}
                        className={`ui-btn w-full py-4 text-lg shadow-sm ${
                          isSubmitting ? 'bg-slate-200 text-slate-400' : 'ui-btn-primary'
                        }`}
                      >
                        {isSubmitting ? '处理中...' : (
                          <>
                            <CheckCircle2 className="w-5 h-5" />
                            批量录入 {batchSummary.matchedCount} 条
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </fieldset>
        </form>
      </section>

      <section className="ui-card overflow-hidden">
        <div className="border-b border-slate-100 p-4 sm:p-5 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900">收银录入记录</h3>
            <p className="mt-0.5 text-xs text-slate-500">按本机输入顺序保存，方便人工核对刚刚录入的订单。</p>
          </div>
          <button
            disabled={!canEdit}
            onClick={() => void clearEntryRecords()}
            className="ui-btn-muted !px-3 !py-1.5 !text-xs !rounded-lg"
          >
            清空
          </button>
        </div>

        <div className="p-4 sm:p-5">
          {entryRecords.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-400">
              暂无收银录入记录
            </div>
          ) : (
            <div className="max-h-[42vh] overflow-y-auto rounded-2xl border border-slate-100 divide-y divide-slate-100">
              {entryRecords.map((item) => (
                <div key={item.id} className="bg-white p-4 text-xs sm:text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-bold text-slate-900">#{item.inputOrder} · {item.productName}</div>
                      <div className="mt-1 text-slate-500">
                        销售员：{item.salesperson || '系统默认'} · 销售日期：{item.saleDate || '未指定'}
                      </div>
                    </div>
                    <div className="shrink-0 text-[11px] text-slate-400">{formatZhDateTime(item.createdAt)}</div>
                  </div>

                  <div className="mt-2 text-slate-700">
                    数量 {item.quantity} · 单价 ￥{item.saleUnitPrice.toFixed(2)} · 小计 ￥{item.totalAmount.toFixed(2)}
                  </div>

                  {item.isNewProduct && (
                    <div className="mt-2 text-[11px] text-amber-700">
                      新商品入库：成本价 ￥{Number(item.costPrice || 0).toFixed(2)} · 初始库存 {item.inventoryInput ?? 0}
                    </div>
                  )}

                  {!!item.abnormalPriceNote && (
                    <div className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-[11px] text-rose-700 border border-rose-100">
                      异常备注：{item.abnormalPriceNote}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
