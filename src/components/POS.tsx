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

const POS_ENTRY_RECORDS_KEY = 'pos_entry_records_v1';
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

export function POS({ store, canEdit = false }: { store: ReturnType<typeof useStore>; canEdit?: boolean }) {
  const { products, categories, sales, addSale, addProduct } = store;
  const [searchTerm, setSearchTerm] = useState('');
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

  useEffect(() => {
    try {
      const raw = localStorage.getItem(POS_ENTRY_RECORDS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setEntryRecords(parsed.slice(-POS_ENTRY_RECORDS_LIMIT));
      }
    } catch {
      setEntryRecords([]);
    }
  }, []);

  const persistEntryRecords = (next: PosEntryRecord[]) => {
    setEntryRecords(next);
    try {
      localStorage.setItem(POS_ENTRY_RECORDS_KEY, JSON.stringify(next));
    } catch {
      // ignore write failure
    }
  };

  const autoMatch = useMemo(() => {
    const text = String(searchTerm || '').trim();
    if (!text) {
      return { matchedProduct: null as MatchSuggestion | null, score: 0, suggestions: [] as MatchSuggestion[] };
    }

    const ranked = products
      .map((product) => ({
        id: product.id,
        name: String(product.name || ''),
        score: scoreModelSimilarity(text, String(product.name || '')),
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
  }, [products, searchTerm]);

  const matchedProduct = autoMatch.matchedProduct;
  const isNewProduct = searchTerm.trim().length > 0 && !matchedProduct;
  const historicalPriceMap = useMemo(() => buildHistoricalPriceMap(sales), [sales]);

  const hasHistoricalReference = useMemo(() => {
    if (!matchedProduct || isNewProduct) return false;
    return (historicalPriceMap.get(matchedProduct.id) || 0) > 0;
  }, [historicalPriceMap, isNewProduct, matchedProduct]);

  const referencePrice = useMemo(() => {
    if (!matchedProduct || isNewProduct) return 0;
    return getReferencePrice({
      product: {
        id: matchedProduct.id,
        name: matchedProduct.name,
        price: matchedProduct.price,
        stock: matchedProduct.stock,
        cost_price: matchedProduct.costPrice,
      },
      historicalPrice: historicalPriceMap.get(matchedProduct.id),
    });
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

  const handleApplySuggestion = (suggestion: MatchSuggestion) => {
    setSearchTerm(suggestion.name);
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

      persistEntryRecords([...entryRecords, record].slice(-POS_ENTRY_RECORDS_LIMIT));
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

  return (
    <div className="max-w-5xl mx-auto space-y-6">
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
                  输入商品名或型号即可自动匹配，不需要精确选择；匹配不到时会直接按新商品流程录入。
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

        <form onSubmit={handleCheckout} className="p-5 sm:p-6 space-y-6">
          <fieldset disabled={!canEdit} className="contents disabled:opacity-60">
            <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_0.95fr] gap-6">
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                      className="ui-input"
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
                      className="ui-input"
                      title="不填则默认使用当前时间"
                    />
                  </div>
                </div>

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
              </div>

              <div className="space-y-4">
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
            onClick={() => persistEntryRecords([])}
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
