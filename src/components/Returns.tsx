import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Pencil, RotateCcw, Search, X } from 'lucide-react';
import { useStore } from '../hooks/useStore';
import { formatZhDateTime } from '../lib/date';
import { appendInboundLogs } from '../lib/inboundLog';
import { supabase } from '../lib/supabase';
import { FeedbackToast, type FeedbackMessage } from './common/FeedbackToast';
import { ReadonlyNotice } from './ReadonlyNotice';
import {
  emitReturnsChanged,
  loadMergedReturns,
  saveLocalReturns,
  subscribeReturnsChanged,
  type ReturnRecord
} from '../lib/returns';

type MatchSuggestion = {
  id: string;
  name: string;
  score: number;
  stock: number;
};

type EditingState = {
  id: string;
  productId?: string;
  productModel: string;
  invoiceNo: string;
  amount: string;
  quantity: string;
  returnDate: string;
  createdAt: string;
};

const AUTO_MATCH_THRESHOLD = 0.7;
const SUGGESTION_THRESHOLD = 0.45;

const normalizeModel = (value: string) =>
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

const buildAutoMatch = (products: Array<any>, text: string) => {
  const keyword = String(text || '').trim();
  if (!keyword) {
    return {
      matchedProduct: null as MatchSuggestion | null,
      score: 0,
      suggestions: [] as MatchSuggestion[],
    };
  }

  const ranked = products
    .map((item: any) => ({
      id: item.id,
      name: String(item.name || ''),
      stock: Number(item.stock) || 0,
      score: scoreModelSimilarity(keyword, String(item.name || '')),
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

const today = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const isTableMissingError = (error: any) => {
  const code = String(error?.code || '').toUpperCase();
  return code === '42P01' || code === 'PGRST205';
};

export function Returns({ store, storeId, canEdit = false }: { store: ReturnType<typeof useStore>; storeId?: string; canEdit?: boolean }) {
  const { products = [], updateProduct } = store || {};

  const [productModel, setProductModel] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [amount, setAmount] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [returnDate, setReturnDate] = useState(today());
  const [submitting, setSubmitting] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [records, setRecords] = useState<ReturnRecord[]>([]);
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const productModelInputRef = useRef<HTMLInputElement>(null);
  const editProductModelInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;

    const loadReturns = async () => {
      const merged = await loadMergedReturns(storeId);
      if (!alive) return;
      setRecords(merged);
    };

    void loadReturns();

    const unsubscribeEvent = subscribeReturnsChanged((changedStoreId) => {
      if (!storeId) return;
      if (changedStoreId && changedStoreId !== storeId) return;
      void loadReturns();
    });

    const channel = storeId
      ? supabase
          .channel(`returns-page-${storeId}`)
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'returns',
            filter: `store_id=eq.${storeId}`
          }, () => {
            void loadReturns();
          })
          .subscribe()
      : null;

    return () => {
      alive = false;
      unsubscribeEvent();
      if (channel) supabase.removeChannel(channel);
    };
  }, [storeId]);

  useEffect(() => {
    productModelInputRef.current?.focus();
  }, [storeId]);

  useEffect(() => {
    setEditing(null);
  }, [storeId]);

  useEffect(() => {
    if (!editing) return;
    window.setTimeout(() => {
      editProductModelInputRef.current?.focus();
      editProductModelInputRef.current?.select();
    }, 0);
  }, [editing]);

  const filteredRecords = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    if (!text) return records;
    return records.filter((item) =>
      String(item.productModel).toLowerCase().includes(text) ||
      String(item.invoiceNo).toLowerCase().includes(text)
    );
  }, [records, keyword]);

  const productNameSuggestions = useMemo(() => {
    return Array.from(new Set((products || []).map((item: any) => String(item.name || '')).filter(Boolean)));
  }, [products]);

  const createAutoMatch = useMemo(() => buildAutoMatch(products, productModel), [productModel, products]);
  const editAutoMatch = useMemo(() => buildAutoMatch(products, editing?.productModel || ''), [editing?.productModel, products]);

  const handleApplySuggestion = (item: MatchSuggestion) => {
    setProductModel(item.name);
    window.setTimeout(() => {
      productModelInputRef.current?.focus();
      productModelInputRef.current?.select();
    }, 0);
  };

  const handleApplyEditSuggestion = (item: MatchSuggestion) => {
    setEditing((prev) => prev ? { ...prev, productModel: item.name } : prev);
    window.setTimeout(() => {
      editProductModelInputRef.current?.focus();
      editProductModelInputRef.current?.select();
    }, 0);
  };

  const persistRecords = (nextRecords: ReturnRecord[]) => {
    setRecords(nextRecords);
    if (storeId) {
      saveLocalReturns(storeId, nextRecords);
      emitReturnsChanged(storeId);
    }
  };

  const resolveProductSnapshot = async (productId?: string, fallbackName?: string) => {
    if (productId) {
      const local = products.find((item: any) => item.id === productId);
      if (local) {
        return {
          id: local.id,
          name: String(local.name || ''),
          stock: Number(local.stock) || 0,
        };
      }

      const { data, error } = await supabase
        .from('products')
        .select('id, name, stock')
        .eq('id', productId)
        .single();

      if (!error && data) {
        return {
          id: data.id,
          name: String(data.name || fallbackName || ''),
          stock: Number(data.stock) || 0,
        };
      }
    }

    const fallbackMatch = buildAutoMatch(products, fallbackName || '').matchedProduct;
    if (fallbackMatch) return fallbackMatch;
    return null;
  };

  const updateProductStock = async (productId: string, nextStock: number) => {
    if (!updateProduct) return false;
    return updateProduct(productId, { stock: nextStock });
  };

  const renderMatchPanel = (
    keywordValue: string,
    autoMatch: ReturnType<typeof buildAutoMatch>,
    onApplySuggestion: (item: MatchSuggestion) => void
  ) => {
    if (!keywordValue.trim()) return null;

    const matchedProduct = autoMatch.matchedProduct;

    return (
      <div className={`rounded-2xl border p-4 transition-all ${
        matchedProduct
          ? 'border-emerald-200 bg-emerald-50/70'
          : autoMatch.suggestions.length > 0
            ? 'border-amber-200 bg-amber-50/70'
            : 'border-slate-200 bg-slate-50'
      }`}>
        {matchedProduct ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">
                  自动匹配成功
                  <span>{Math.round(autoMatch.score * 100)}%</span>
                </div>
                <p className="mt-3 text-lg font-black text-slate-900">{matchedProduct.name}</p>
                <p className="mt-1 text-sm text-slate-600">系统会按这个商品自动回补库存，不需要精确输入全名。</p>
              </div>
              <div className="rounded-2xl bg-white/90 px-4 py-3 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">当前库存</div>
                <div className="mt-1 font-mono text-xl font-black text-slate-900">{matchedProduct.stock}</div>
              </div>
            </div>

            {autoMatch.suggestions.length > 1 && (
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">其他候选</p>
                <div className="flex flex-wrap gap-2">
                  {autoMatch.suggestions
                    .filter((item) => item.id !== matchedProduct.id)
                    .map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onApplySuggestion(item)}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        改用 {item.name} · {Math.round(item.score * 100)}%
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
        ) : autoMatch.suggestions.length > 0 ? (
          <div className="space-y-3">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
                接近候选
                <span>{Math.round(autoMatch.score * 100)}%</span>
              </div>
              <p className="mt-3 text-sm text-slate-700">还没到自动匹配阈值，你可以点一个最接近的商品继续。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {autoMatch.suggestions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onApplySuggestion(item)}
                  className="rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                >
                  选择 {item.name} · {Math.round(item.score * 100)}%
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm font-semibold text-slate-700">暂时没有匹配到可用商品。</p>
            <p className="mt-1 text-sm text-slate-500">可以换个关键词、补充型号，或者用更接近库存里的商品名。</p>
          </div>
        )}
      </div>
    );
  };

  const startEdit = (record: ReturnRecord) => {
    setEditing({
      id: record.id,
      productId: record.productId,
      productModel: record.productModel,
      invoiceNo: record.invoiceNo,
      amount: String(record.amount),
      quantity: String(record.quantity),
      returnDate: record.returnDate,
      createdAt: record.createdAt,
    });
  };

  const cancelEdit = () => {
    setEditing(null);
  };

  const adjustEditQuantity = (delta: number) => {
    setEditing((prev) => {
      if (!prev) return prev;
      const current = Number.parseInt(prev.quantity, 10);
      const base = Number.isFinite(current) ? current : 1;
      return {
        ...prev,
        quantity: String(Math.max(1, base + delta)),
      };
    });
  };

  const handleEditKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void saveEdit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  };

  const handleSubmit = async () => {
    if (!canEdit || submitting) return;

    if (!storeId) {
      setFeedback({ type: 'error', text: '请先选择门店。' });
      return;
    }
    if (!updateProduct) {
      setFeedback({ type: 'error', text: '库存更新功能未就绪。' });
      return;
    }

    const matchedProduct = createAutoMatch.matchedProduct;
    const modelText = productModel.trim();
    const billNo = invoiceNo.trim();
    const qty = Number(quantity);
    const money = Number(amount);

    if (!modelText) return setFeedback({ type: 'error', text: '请填写产品型号。' });
    if (!billNo) return setFeedback({ type: 'error', text: '请填写发票单号。' });
    if (!Number.isFinite(money) || money < 0) return setFeedback({ type: 'error', text: '金额格式不正确。' });
    if (!Number.isInteger(qty)) return setFeedback({ type: 'error', text: '数量必须为整数。' });
    if (!Number.isFinite(qty) || qty <= 0) return setFeedback({ type: 'error', text: '数量必须大于 0。' });
    if (!returnDate) return setFeedback({ type: 'error', text: '请选择退货日期。' });
    if (!matchedProduct) {
      setFeedback({ type: 'error', text: '当前输入还没有匹配到合适商品，请换个关键词或点下方候选。' });
      return;
    }

    const currentStock = Number(matchedProduct.stock) || 0;
    setSubmitting(true);
    const ok = await updateProduct(matchedProduct.id, { stock: currentStock + qty });
    if (!ok) {
      setSubmitting(false);
      setFeedback({ type: 'error', text: '退货入库失败，请稍后重试。' });
      return;
    }

    const nextRecord: ReturnRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      productId: matchedProduct.id,
      productModel: matchedProduct.name,
      invoiceNo: billNo,
      amount: money,
      quantity: qty,
      returnDate,
      createdAt: new Date().toISOString(),
      storeId,
    };

    const nextRecords = [nextRecord, ...records].slice(0, 500);
    persistRecords(nextRecords);

    await appendInboundLogs([
      {
        storeId,
        source: 'return',
        productName: matchedProduct.name,
        qty,
        note: `退货入库（发票：${billNo}）`,
        time: new Date(`${returnDate}T00:00:00`).toISOString()
      }
    ]);

    const { error: writeReturnError } = await supabase
      .from('returns')
      .insert([
        {
          store_id: storeId,
          product_id: matchedProduct.id,
          product_model: matchedProduct.name,
          invoice_no: billNo,
          amount: money,
          quantity: qty,
          return_date: returnDate,
          created_at: new Date().toISOString()
        }
      ]);

    setSubmitting(false);

    if (writeReturnError && !isTableMissingError(writeReturnError)) {
      setFeedback({ type: 'error', text: `退货已入库，但退货记录写入失败：${writeReturnError.message}` });
      return;
    }

    setProductModel('');
    setInvoiceNo('');
    setAmount('');
    setQuantity('1');
    setReturnDate(today());

    window.setTimeout(() => {
      productModelInputRef.current?.focus();
      productModelInputRef.current?.select();
    }, 0);

    setFeedback({ type: 'success', text: `已自动匹配“${matchedProduct.name}”并完成退货入库。` });
  };

  const saveEdit = async () => {
    if (!editing || !canEdit || savingEdit) return;
    if (!storeId) {
      setFeedback({ type: 'error', text: '请先选择门店。' });
      return;
    }
    if (!updateProduct) {
      setFeedback({ type: 'error', text: '库存更新功能未就绪。' });
      return;
    }

    const currentRecord = records.find((item) => item.id === editing.id);
    if (!currentRecord) {
      setFeedback({ type: 'error', text: '未找到要编辑的退货记录。' });
      return;
    }

    const matchedProduct = editAutoMatch.matchedProduct;
    const nextInvoiceNo = editing.invoiceNo.trim();
    const nextQuantity = Number(editing.quantity);
    const nextAmount = Number(editing.amount);

    if (!editing.productModel.trim()) return setFeedback({ type: 'error', text: '请填写产品型号。' });
    if (!matchedProduct) return setFeedback({ type: 'error', text: '请先匹配到一个有效商品，再保存编辑。' });
    if (!nextInvoiceNo) return setFeedback({ type: 'error', text: '请填写发票单号。' });
    if (!Number.isFinite(nextAmount) || nextAmount < 0) return setFeedback({ type: 'error', text: '金额格式不正确。' });
    if (!Number.isInteger(nextQuantity) || nextQuantity <= 0) return setFeedback({ type: 'error', text: '数量必须为大于 0 的整数。' });
    if (!editing.returnDate) return setFeedback({ type: 'error', text: '请选择退货日期。' });

    setSavingEdit(true);

    const previousProduct = await resolveProductSnapshot(currentRecord.productId || editing.productId, currentRecord.productModel);
    const nextProduct = await resolveProductSnapshot(matchedProduct.id, matchedProduct.name);

    if (!previousProduct || !nextProduct) {
      setSavingEdit(false);
      setFeedback({ type: 'error', text: '无法定位退货商品库存，请刷新后重试。' });
      return;
    }

    const previousQuantity = Number(currentRecord.quantity) || 0;
    const isSameProduct = previousProduct.id === nextProduct.id;
    let stockSynced = false;

    if (isSameProduct) {
      const diff = nextQuantity - previousQuantity;
      if (diff !== 0) {
        stockSynced = await updateProductStock(previousProduct.id, previousProduct.stock + diff);
      } else {
        stockSynced = true;
      }
    } else {
      const revertedOld = await updateProductStock(previousProduct.id, previousProduct.stock - previousQuantity);
      if (!revertedOld) {
        setSavingEdit(false);
        setFeedback({ type: 'error', text: '原商品库存回滚失败，请稍后重试。' });
        return;
      }

      const appliedNew = await updateProductStock(nextProduct.id, nextProduct.stock + nextQuantity);
      if (!appliedNew) {
        await updateProductStock(previousProduct.id, previousProduct.stock);
        setSavingEdit(false);
        setFeedback({ type: 'error', text: '新商品库存调整失败，请稍后重试。' });
        return;
      }

      stockSynced = true;
    }

    if (!stockSynced) {
      setSavingEdit(false);
      setFeedback({ type: 'error', text: '库存同步失败，请稍后重试。' });
      return;
    }

    const nextRecord: ReturnRecord = {
      ...currentRecord,
      productId: nextProduct.id,
      productModel: nextProduct.name,
      invoiceNo: nextInvoiceNo,
      amount: nextAmount,
      quantity: nextQuantity,
      returnDate: editing.returnDate,
      storeId,
    };

    const { error: updateError } = await supabase
      .from('returns')
      .update({
        product_id: nextRecord.productId,
        product_model: nextRecord.productModel,
        invoice_no: nextRecord.invoiceNo,
        amount: nextRecord.amount,
        quantity: nextRecord.quantity,
        return_date: nextRecord.returnDate,
      })
      .eq('id', nextRecord.id);

    if (updateError && !isTableMissingError(updateError)) {
      if (isSameProduct) {
        await updateProductStock(previousProduct.id, previousProduct.stock);
      } else {
        await updateProductStock(previousProduct.id, previousProduct.stock);
        await updateProductStock(nextProduct.id, nextProduct.stock);
      }
      setSavingEdit(false);
      setFeedback({ type: 'error', text: `退货记录保存失败：${updateError.message}` });
      return;
    }

    const nextRecords = records.map((item) => item.id === nextRecord.id ? nextRecord : item);
    persistRecords(nextRecords);
    setSavingEdit(false);
    setEditing(null);
    setFeedback({ type: 'success', text: `退货记录已更新，并同步校正“${nextProduct.name}”库存。` });
  };

  const handleFormSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void handleSubmit();
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <FeedbackToast message={feedback} onClose={() => setFeedback(null)} />
      {!canEdit && <ReadonlyNotice description="退货记录可查看，但只有管理员可以提交和编辑退货记录。" />}

      <form onSubmit={handleFormSubmit} className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-slate-100 space-y-4">
        <fieldset disabled={!canEdit} className="contents disabled:opacity-60">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-emerald-500 text-white rounded-2xl shadow-lg shadow-emerald-200">
              <RotateCcw className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">退货管理</h2>
              <p className="text-slate-500 text-sm">登记退货信息并自动回补库存</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
            <div className="xl:col-span-2">
              <label className="block text-xs text-slate-500 mb-1">产品型号</label>
              <input
                ref={productModelInputRef}
                list="return-product-model-options"
                value={productModel}
                onChange={(event) => setProductModel(event.target.value)}
                placeholder="输入商品名或型号，系统会自动匹配"
                className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <datalist id="return-product-model-options">
                {productNameSuggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">发票单号</label>
              <input
                value={invoiceNo}
                onChange={(event) => setInvoiceNo(event.target.value)}
                placeholder="输入发票单号"
                className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">金额</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">数量</label>
              <input
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">日期</label>
              <input
                type="date"
                value={returnDate}
                onChange={(event) => setReturnDate(event.target.value)}
                className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {renderMatchPanel(productModel, createAutoMatch, handleApplySuggestion)}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="h-11 px-5 bg-slate-900 text-white hover:bg-slate-800 rounded-xl font-bold transition-all inline-flex items-center justify-center gap-2 border border-slate-900 shadow-sm text-sm disabled:opacity-60"
            >
              {submitting ? '处理中...' : '提交退货并入库'}
            </button>
          </div>
        </fieldset>
      </form>

      <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-slate-100 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
              退货记录
              <span>{filteredRecords.length}</span>
            </div>
            <p className="mt-2 text-sm text-slate-500">支持搜索、编辑，并在保存时自动同步校正库存。</p>
          </div>

          <div className="relative w-full lg:w-80">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索型号或发票号"
              className="w-full h-11 pl-9 pr-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {editing && (
          <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4 sm:p-5 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900">编辑退货记录</h3>
                <p className="mt-1 text-sm text-slate-500">改完保存后，会自动同步修正对应商品库存。</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>创建于 {formatZhDateTime(editing.createdAt)}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
              <div className="xl:col-span-2">
                <label className="block text-xs text-slate-500 mb-1">产品型号</label>
                <input
                  ref={editProductModelInputRef}
                  list="return-product-model-options"
                  value={editing.productModel}
                  onChange={(event) => setEditing((prev) => prev ? { ...prev, productModel: event.target.value } : prev)}
                  onKeyDown={handleEditKeyDown}
                  className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">发票单号</label>
                <input
                  value={editing.invoiceNo}
                  onChange={(event) => setEditing((prev) => prev ? { ...prev, invoiceNo: event.target.value } : prev)}
                  onKeyDown={handleEditKeyDown}
                  className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">金额</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editing.amount}
                  onChange={(event) => setEditing((prev) => prev ? { ...prev, amount: event.target.value } : prev)}
                  onKeyDown={handleEditKeyDown}
                  className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">数量</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => adjustEditQuantity(-1)}
                    className="h-11 w-11 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={editing.quantity}
                    onChange={(event) => setEditing((prev) => prev ? { ...prev, quantity: event.target.value } : prev)}
                    onKeyDown={handleEditKeyDown}
                    className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm text-center outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => adjustEditQuantity(1)}
                    className="h-11 w-11 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  >
                    +
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">日期</label>
                <input
                  type="date"
                  value={editing.returnDate}
                  onChange={(event) => setEditing((prev) => prev ? { ...prev, returnDate: event.target.value } : prev)}
                  onKeyDown={handleEditKeyDown}
                  className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            {renderMatchPanel(editing.productModel, editAutoMatch, handleApplyEditSuggestion)}

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                className="h-11 px-4 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold hover:bg-slate-50 inline-flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                取消
              </button>
              <button
                type="button"
                onClick={() => void saveEdit()}
                disabled={savingEdit}
                className="h-11 px-4 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 inline-flex items-center gap-2 disabled:opacity-60"
              >
                <Check className="w-4 h-4" />
                {savingEdit ? '保存中...' : '保存修改'}
              </button>
            </div>
          </div>
        )}

        {filteredRecords.length === 0 ? (
          <div className="text-sm text-slate-400 py-10 text-center">暂无退货记录</div>
        ) : (
          <>
            <div className="sm:hidden space-y-3">
              {filteredRecords.map((item) => {
                const isEditing = editing?.id === item.id;
                return (
                  <div
                    key={item.id}
                    className={`rounded-2xl border p-4 transition-all ${
                      isEditing ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-bold text-slate-900">{item.productModel}</p>
                        <p className="mt-1 text-xs text-slate-500">发票 {item.invoiceNo}</p>
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                          aria-label="编辑退货记录"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-2xl bg-slate-50 px-3 py-3">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">金额</div>
                        <div className="mt-1 text-lg font-black text-slate-900">¥ {Number(item.amount || 0).toFixed(2)}</div>
                      </div>
                      <div className="rounded-2xl bg-emerald-50 px-3 py-3">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-600/70">数量</div>
                        <div className="mt-1 text-lg font-black text-emerald-700">+{item.quantity}</div>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                      <span>{item.returnDate}</span>
                      <span>{formatZhDateTime(item.createdAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3">产品型号</th>
                    <th className="px-4 py-3">发票单号</th>
                    <th className="px-4 py-3">金额</th>
                    <th className="px-4 py-3">数量</th>
                    <th className="px-4 py-3">日期</th>
                    <th className="px-4 py-3">登记时间</th>
                    <th className="px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRecords.map((item) => {
                    const isEditing = editing?.id === item.id;
                    return (
                      <tr key={item.id} className={isEditing ? 'bg-emerald-50/50' : 'hover:bg-slate-50/70'}>
                        <td className="px-4 py-3 font-medium text-slate-700">{item.productModel}</td>
                        <td className="px-4 py-3 text-slate-600">{item.invoiceNo}</td>
                        <td className="px-4 py-3 text-slate-600">¥ {Number(item.amount || 0).toFixed(2)}</td>
                        <td className="px-4 py-3 text-emerald-600 font-semibold">+{item.quantity}</td>
                        <td className="px-4 py-3 text-slate-600">{item.returnDate}</td>
                        <td className="px-4 py-3 text-slate-500">{formatZhDateTime(item.createdAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end">
                            {canEdit ? (
                              <button
                                type="button"
                                onClick={() => startEdit(item)}
                                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
                                  isEditing
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                {isEditing ? '编辑中' : '编辑'}
                              </button>
                            ) : (
                              <span className="text-xs text-slate-300">只读</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
