import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Search } from 'lucide-react';
import { useStore } from '../hooks/useStore';
import { formatZhDateTime } from '../lib/date';
import { appendInboundLogs } from '../lib/inboundLog';
import { supabase } from '../lib/supabase';
import { FeedbackToast, type FeedbackMessage } from './common/FeedbackToast';
import { emitReturnsChanged, loadLocalReturns, saveLocalReturns, type ReturnRecord } from '../lib/returns';

const normalizeModel = (value: string) =>
  String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[\-_./\\()[\]{}]+/g, '')
    .trim();

const today = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export function Returns({ store, storeId }: { store: ReturnType<typeof useStore>; storeId?: string }) {
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
    return (products || []).map((item: any) => String(item.name || '')).filter(Boolean);
  }, [products]);

  const matchProduct = (modelText: string) => {
    const target = normalizeModel(modelText);
    if (!target) return null;

    const exact = (products || []).find((item: any) => normalizeModel(item.name) === target);
    if (exact) return exact;

    const include = (products || []).find((item: any) => {
      const name = normalizeModel(item.name);
      return name.includes(target) || target.includes(name);
    });
    if (include) return include;

    return null;
  };

  const handleSubmit = async () => {
    if (submitting) return;

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

    const matched = matchProduct(modelText);
    if (!matched) {
      setFeedback({ type: 'error', text: '未匹配到商品型号，请输入更准确的型号名称。' });
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

    setFeedback({ type: 'success', text: '退货已登记，库存已累加。' });
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSubmit();
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <FeedbackToast message={feedback} onClose={() => setFeedback(null)} />

      <form onSubmit={handleFormSubmit} className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-slate-100 space-y-4">
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
              placeholder="输入产品型号"
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

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="h-11 px-5 bg-slate-900 text-white hover:bg-slate-800 rounded-xl font-bold transition-all inline-flex items-center justify-center gap-2 border border-slate-900 shadow-sm text-sm disabled:opacity-60"
          >
            {submitting ? '处理中...' : '提交退货并入库'}
          </button>
        </div>
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
