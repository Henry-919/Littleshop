import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Search } from 'lucide-react';
import { useStore } from '../hooks/useStore';
import { formatZhDateTime } from '../lib/date';
import { appendInboundLogs } from '../lib/inboundLog';
import { supabase } from '../lib/supabase';
import { FeedbackToast, type FeedbackMessage } from './common/FeedbackToast';
import { ReadonlyNotice } from './ReadonlyNotice';
import { emitReturnsChanged, loadLocalReturns, saveLocalReturns, type ReturnRecord } from '../lib/returns';

type MatchSuggestion = {
  id: string;
  name: string;
  score: number;
  stock: number;
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

const today = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
  const [records, setRecords] = useState<ReturnRecord[]>(() => loadLocalReturns(storeId));
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);
  const productModelInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecords(loadLocalReturns(storeId));
  }, [storeId]);

  useEffect(() => {
    productModelInputRef.current?.focus();
  }, [storeId]);

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

  const autoMatch = useMemo(() => {
    const text = String(productModel || '').trim();
    if (!text) {
      return {
        matchedProduct: null as MatchSuggestion | null,
        score: 0,
        suggestions: [] as MatchSuggestion[],
      };
    }

    const ranked = (products || [])
      .map((item: any) => ({
        id: item.id,
        name: String(item.name || ''),
        stock: Number(item.stock) || 0,
        score: scoreModelSimilarity(text, String(item.name || '')),
      }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0] || null;
    const suggestions = ranked.filter((item) => item.score >= SUGGESTION_THRESHOLD).slice(0, 3);

    return {
      matchedProduct: best && best.score >= AUTO_MATCH_THRESHOLD ? best : null,
      score: best?.score || 0,
      suggestions,
    };
  }, [productModel, products]);

  const matchedProduct = autoMatch.matchedProduct;

  const handleApplySuggestion = (item: MatchSuggestion) => {
    setProductModel(item.name);
    window.setTimeout(() => {
      productModelInputRef.current?.focus();
      productModelInputRef.current?.select();
    }, 0);
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

    const matched = matchedProduct;
    if (!matched) {
      setFeedback({ type: 'error', text: '当前输入还没有匹配到合适商品，请换个关键词或点下方候选。' });
      return;
    }

    const currentStock = Number(matched.stock) || 0;
    setSubmitting(true);
    const ok = await updateProduct(matched.id, { stock: currentStock + qty });
    setSubmitting(false);

    if (!ok) {
      setFeedback({ type: 'error', text: '退货入库失败，请稍后重试。' });
      return;
    }

    const nextRecord: ReturnRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      productModel: String(matched.name || modelText),
      invoiceNo: billNo,
      amount: money,
      quantity: qty,
      returnDate,
      createdAt: new Date().toISOString()
    };

    const next = [nextRecord, ...records].slice(0, 500);
    setRecords(next);
    saveLocalReturns(storeId, next);

    appendInboundLogs([
      {
        storeId,
        source: 'return',
        productName: String(matched.name || modelText),
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
          product_id: matched.id,
          product_model: String(matched.name || modelText),
          invoice_no: billNo,
          amount: money,
          quantity: qty,
          return_date: returnDate,
          created_at: new Date().toISOString()
        }
      ]);
    if (writeReturnError && writeReturnError.code !== '42P01') {
      console.warn('Write returns log failed:', writeReturnError.message);
      setFeedback({ type: 'error', text: `退货已入库，但退货记录写入失败：${writeReturnError.message}` });
    }

    emitReturnsChanged(storeId);

    setProductModel('');
    setInvoiceNo('');
    setAmount('');
    setQuantity('1');
    setReturnDate(today());

    setTimeout(() => {
      productModelInputRef.current?.focus();
      productModelInputRef.current?.select();
    }, 0);

    setFeedback({ type: 'success', text: `已自动匹配“${matched.name}”并完成退货入库。` });
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSubmit();
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <FeedbackToast message={feedback} onClose={() => setFeedback(null)} />
      {!canEdit && <ReadonlyNotice description="退货记录可查看，但只有管理员可以提交退货并回补库存。" />}

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
                onChange={(e) => setProductModel(e.target.value)}
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
                onChange={(e) => setInvoiceNo(e.target.value)}
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
                onChange={(e) => setAmount(e.target.value)}
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
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">日期</label>
              <input
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {productModel.trim() && (
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
                      <p className="mt-1 text-sm text-slate-600">提交时会按这个商品自动回补库存，不需要精确输入全名。</p>
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
                              onClick={() => handleApplySuggestion(item)}
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
                        onClick={() => handleApplySuggestion(item)}
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
          )}

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

      <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-slate-100 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-900">退货记录</h3>
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索型号或发票号"
              className="w-full h-10 pl-9 pr-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {filteredRecords.length === 0 ? (
          <div className="text-sm text-slate-400 py-8 text-center">暂无退货记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3">产品型号</th>
                  <th className="px-4 py-3">发票单号</th>
                  <th className="px-4 py-3">金额</th>
                  <th className="px-4 py-3">数量</th>
                  <th className="px-4 py-3">日期</th>
                  <th className="px-4 py-3">登记时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRecords.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 font-medium text-slate-700">{item.productModel}</td>
                    <td className="px-4 py-3 text-slate-600">{item.invoiceNo}</td>
                    <td className="px-4 py-3 text-slate-600">¥ {Number(item.amount || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-emerald-600 font-semibold">+{item.quantity}</td>
                    <td className="px-4 py-3 text-slate-600">{item.returnDate}</td>
                    <td className="px-4 py-3 text-slate-500">{formatZhDateTime(item.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
