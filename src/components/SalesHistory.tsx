import React, { useState, useCallback } from 'react';
import { useStore } from '../hooks/useStore';
import { Trash2, History, ReceiptText, User, X, Pencil, Check, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

type EditingState = {
  saleId: string;
  productId: string;
  quantity: string;
  totalAmount: string;
  salesperson: string;
  date: string;
};

export function SalesHistory({ store, storeId }: { store: ReturnType<typeof useStore>; storeId?: string }) {
  const { sales, products, deleteSale, updateSale } = store;
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedSales, setDeletedSales] = useState<any[]>([]);
  const [deletedLoading, setDeletedLoading] = useState(false);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [saving, setSaving] = useState(false);

  const getProductName = (id: string) => {
    return products.find(p => p.id === id)?.name || '未知商品';
  };

  const handleDelete = async (saleId: string) => {
    if (window.confirm('确定要撤销这条销售记录吗？\n撤销后该商品的库存将自动还原。')) {
      await deleteSale(saleId);
      if (editing?.saleId === saleId) setEditing(null);
    }
  };

  const startEdit = useCallback((sale: any) => {
    setEditing({
      saleId: sale.id,
      productId: sale.productId,
      quantity: String(sale.quantity),
      totalAmount: String(sale.totalAmount || 0),
      salesperson: sale.salesperson || '',
      date: sale.date ? sale.date.slice(0, 10) : ''
    });
  }, []);

  const cancelEdit = () => setEditing(null);

  const saveEdit = async () => {
    if (!editing || !updateSale) return;
    const qty = parseInt(editing.quantity, 10);
    const amt = parseFloat(editing.totalAmount);
    if (!Number.isFinite(qty) || qty <= 0) return;
    if (!Number.isFinite(amt) || amt < 0) return;

    setSaving(true);
    try {
      const ok = await updateSale(editing.saleId, {
        productId: editing.productId,
        quantity: qty,
        totalAmount: amt,
        salesperson: editing.salesperson,
        date: editing.date || undefined
      });
      if (ok) setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const sortedSales = [...sales].sort((a, b) => {
    const dateA = new Date(a.date || 0).getTime();
    const dateB = new Date(b.date || 0).getTime();
    return dateB - dateA;
  });

  const loadDeletedSales = async () => {
    if (!storeId) return;
    setDeletedLoading(true);
    const { data, error } = await supabase
      .from('sales')
      .select('id, product_id, quantity, total_amount, salesperson, date, deleted_at')
      .eq('store_id', storeId)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false });
    if (!error && data) {
      setDeletedSales(data);
    }
    setDeletedLoading(false);
  };

  const renderMobileCard = (sale: any) => {
    const isEditing = editing?.saleId === sale.id;
    const totalAmount = sale.totalAmount || 0;
    const date = sale.date;

    if (isEditing && editing) {
      return (
        <div key={sale.id} className="bg-sky-50/80 border border-sky-200 rounded-xl p-3 space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-slate-500 font-medium">日期</label>
              <input
                type="date"
                value={editing.date}
                onChange={e => setEditing({ ...editing, date: e.target.value })}
                className="w-full px-2 py-2 border border-sky-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-400 outline-none bg-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 font-medium">收银员</label>
              <input
                type="text"
                value={editing.salesperson}
                onChange={e => setEditing({ ...editing, salesperson: e.target.value })}
                className="w-full px-2 py-2 border border-sky-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-400 outline-none bg-white"
                placeholder="收银员"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 font-medium">商品</label>
            <select
              value={editing.productId}
              onChange={e => setEditing({ ...editing, productId: e.target.value })}
              className="w-full px-2 py-2 border border-sky-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-400 outline-none bg-white"
            >
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-slate-500 font-medium">数量</label>
              <input
                type="number"
                min="1"
                value={editing.quantity}
                onChange={e => {
                  const qty = e.target.value;
                  const parsedQty = parseInt(qty, 10);
                  const oldQty = Number(editing.quantity) || 1;
                  const unitPrice = Number(editing.totalAmount) / oldQty;
                  const newTotal = Number.isFinite(parsedQty) && parsedQty > 0 && Number.isFinite(unitPrice) && unitPrice > 0
                    ? (parsedQty * unitPrice).toFixed(2)
                    : editing.totalAmount;
                  setEditing({ ...editing, quantity: qty, totalAmount: newTotal });
                }}
                className="w-full px-2 py-2 border border-sky-200 rounded-lg text-sm text-right focus:ring-2 focus:ring-sky-400 outline-none font-mono bg-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 font-medium">金额 (￥)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={editing.totalAmount}
                onChange={e => setEditing({ ...editing, totalAmount: e.target.value })}
                className="w-full px-2 py-2 border border-sky-200 rounded-lg text-sm text-right focus:ring-2 focus:ring-sky-400 outline-none font-mono bg-white"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={saveEdit}
              disabled={saving}
              className="flex-1 py-2 bg-emerald-500 text-white rounded-lg text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-1"
            >
              <Check className="w-3.5 h-3.5" /> 保存
            </button>
            <button
              onClick={cancelEdit}
              disabled={saving}
              className="flex-1 py-2 bg-white text-slate-600 border border-slate-200 rounded-lg text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-1"
            >
              <XCircle className="w-3.5 h-3.5" /> 取消
            </button>
          </div>
        </div>
      );
    }

    return (
      <div key={sale.id} className="bg-white border border-slate-100 rounded-xl p-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-slate-800 text-sm truncate">{getProductName(sale.productId)}</span>
            <span className="shrink-0 px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 font-mono text-[11px]">×{sale.quantity}</span>
          </div>
          <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
            <span>{date ? new Date(date).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}</span>
            <span>·</span>
            <span>{sale.salesperson || '系统默认'}</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-black text-emerald-600 text-sm">￥{Number(totalAmount).toFixed(2)}</div>
        </div>
        <div className="flex flex-col gap-0.5 shrink-0">
          <button
            onClick={() => startEdit(sale)}
            className="p-1.5 text-slate-300 hover:text-sky-500 hover:bg-sky-50 rounded-lg transition-all"
            title="编辑"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleDelete(sale.id)}
            className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
            title="撤销"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  };

  const renderDesktopRow = (sale: any) => {
    const isEditing = editing?.saleId === sale.id;
    const totalAmount = sale.totalAmount || 0;
    const date = sale.date;

    if (isEditing && editing) {
      return (
        <tr key={sale.id} className="bg-sky-50/60">
          <td className="px-6 py-3">
            <input
              type="date"
              value={editing.date}
              onChange={e => setEditing({ ...editing, date: e.target.value })}
              className="w-full px-2 py-1.5 border border-sky-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-400 outline-none"
            />
          </td>
          <td className="px-6 py-3">
            <select
              value={editing.productId}
              onChange={e => setEditing({ ...editing, productId: e.target.value })}
              className="w-full px-2 py-1.5 border border-sky-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-400 outline-none"
            >
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </td>
          <td className="px-6 py-3">
            <input
              type="number"
              min="1"
              value={editing.quantity}
              onChange={e => {
                const qty = e.target.value;
                const parsedQty = parseInt(qty, 10);
                const oldQty = Number(editing.quantity) || 1;
                const unitPrice = Number(editing.totalAmount) / oldQty;
                const newTotal = Number.isFinite(parsedQty) && parsedQty > 0 && Number.isFinite(unitPrice) && unitPrice > 0
                  ? (parsedQty * unitPrice).toFixed(2)
                  : editing.totalAmount;
                setEditing({ ...editing, quantity: qty, totalAmount: newTotal });
              }}
              className="w-20 px-2 py-1.5 border border-sky-200 rounded-lg text-sm text-right focus:ring-2 focus:ring-sky-400 outline-none font-mono"
            />
          </td>
          <td className="px-6 py-3">
            <div className="flex items-center gap-1">
              <span className="text-sm text-slate-400">￥</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={editing.totalAmount}
                onChange={e => setEditing({ ...editing, totalAmount: e.target.value })}
                className="w-24 px-2 py-1.5 border border-sky-200 rounded-lg text-sm text-right focus:ring-2 focus:ring-sky-400 outline-none font-mono"
              />
            </div>
          </td>
          <td className="px-6 py-3">
            <input
              type="text"
              value={editing.salesperson}
              onChange={e => setEditing({ ...editing, salesperson: e.target.value })}
              className="w-full px-2 py-1.5 border border-sky-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-400 outline-none"
              placeholder="收银员"
            />
          </td>
          <td className="px-6 py-3 text-right">
            <div className="flex items-center justify-end gap-1">
              <button
                onClick={saveEdit}
                disabled={saving}
                className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all disabled:opacity-50"
                title="保存"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={cancelEdit}
                disabled={saving}
                className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg transition-all disabled:opacity-50"
                title="取消"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          </td>
        </tr>
      );
    }

    return (
      <tr key={sale.id} className="hover:bg-slate-50/50 transition-colors group">
        <td className="px-6 py-4 text-slate-500 whitespace-nowrap text-sm">
          {date ? new Date(date).toLocaleString('zh-CN', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }) : '-'}
        </td>
        <td className="px-6 py-4">
          <div className="flex items-center gap-2">
            <ReceiptText className="w-4 h-4 text-slate-300" />
            <span className="font-bold text-slate-800 text-sm">{getProductName(sale.productId)}</span>
          </div>
        </td>
        <td className="px-6 py-4">
          <span className="px-2 py-1 bg-slate-100 rounded text-slate-600 font-mono text-sm">
            {sale.quantity}
          </span>
        </td>
        <td className="px-6 py-4 font-black text-emerald-600 text-sm">
          ￥{Number(totalAmount).toFixed(2)}
        </td>
        <td className="px-6 py-4">
          <div className="flex items-center gap-1.5 text-slate-500 text-sm">
            <User className="w-3.5 h-3.5" />
            {sale.salesperson || '系统默认'}
          </div>
        </td>
        <td className="px-6 py-4 text-right">
          <div className="flex items-center justify-end gap-0.5">
            <button
              onClick={() => startEdit(sale)}
              className="p-2 text-slate-300 hover:text-sky-500 hover:bg-sky-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
              title="编辑"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleDelete(sale.id)}
              className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
              title="撤销此单"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="p-4 sm:p-6 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="p-2.5 sm:p-3 bg-amber-100 text-amber-600 rounded-xl shrink-0">
            <History className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <h2 className="text-lg sm:text-2xl font-bold text-slate-900">销售流水</h2>
            <p className="text-slate-500 text-xs sm:text-sm mt-0.5 sm:mt-1 hidden sm:block">查看并管理近期的所有交易记录</p>
            <p className="text-slate-400 text-xs sm:hidden mt-0.5">{sales.length} 条记录</p>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="hidden md:block text-right">
            <p className="text-xs text-slate-400 uppercase tracking-widest font-bold">总交易数</p>
            <p className="text-2xl font-black text-slate-900">{sales.length}</p>
          </div>
          <button
            onClick={async () => {
              setShowDeleted(true);
              await loadDeletedSales();
            }}
            className="px-3 py-2 bg-slate-900 text-white hover:bg-slate-800 rounded-xl font-bold transition-all border border-slate-900 shadow-sm text-xs sm:text-sm whitespace-nowrap"
          >
            删除记录
          </button>
        </div>
      </div>

      {/* Mobile Card List */}
      <div className="sm:hidden space-y-2 px-0.5">
        {sortedSales.map(sale => renderMobileCard(sale))}
        {sales.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 py-16 flex flex-col items-center gap-2 text-slate-300">
            <History className="w-10 h-10 opacity-10" />
            <p className="text-base font-medium">暂无销售流水</p>
            <p className="text-xs">一旦开始销售，记录将显示在这里</p>
          </div>
        )}
      </div>

      {/* Desktop Table */}
      <div className="hidden sm:block bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 text-slate-500 text-xs uppercase tracking-wider">
                <th className="px-6 py-4 font-semibold">交易时间</th>
                <th className="px-6 py-4 font-semibold">商品详情</th>
                <th className="px-6 py-4 font-semibold">数量</th>
                <th className="px-6 py-4 font-semibold">成交金额</th>
                <th className="px-6 py-4 font-semibold">收银员</th>
                <th className="px-6 py-4 font-semibold text-right">操作</th>
              </tr>
            </thead>
            <tbody className="text-sm divide-y divide-slate-50">
              {sortedSales.map(sale => renderDesktopRow(sale))}
              {sales.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center gap-2 text-slate-300">
                      <History className="w-12 h-12 opacity-10" />
                      <p className="text-lg font-medium">暂无销售流水</p>
                      <p className="text-sm">一旦开始销售，记录将显示在这里</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Deleted Sales Modal */}
      {showDeleted && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[110] flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-4xl max-h-[85vh] sm:max-h-[80vh] overflow-hidden border border-slate-100 flex flex-col">
            <div className="p-4 sm:p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
              <h3 className="text-base sm:text-lg font-bold text-slate-900">删除记录 - 销售</h3>
              <button
                onClick={() => setShowDeleted(false)}
                className="p-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 sm:p-6 overflow-y-auto flex-1">
              {deletedLoading ? (
                <div className="text-slate-400 text-sm">加载中...</div>
              ) : deletedSales.length === 0 ? (
                <div className="text-slate-400 text-sm">暂无删除记录</div>
              ) : (
                <>
                  {/* Mobile deleted cards */}
                  <div className="sm:hidden space-y-2">
                    {deletedSales.map((item) => (
                      <div key={item.id} className="bg-slate-50 rounded-xl p-3">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-slate-700 text-sm truncate">
                            {products.find(p => p.id === item.product_id)?.name || '未知商品'}
                          </span>
                          <span className="text-emerald-600 font-bold text-sm">￥{Number(item.total_amount || 0).toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between mt-1.5 text-[11px] text-slate-400">
                          <span>×{item.quantity}</span>
                          <span>删除于 {item.deleted_at ? new Date(item.deleted_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Desktop deleted table */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                          <th className="px-6 py-3">日期</th>
                          <th className="px-6 py-3">商品</th>
                          <th className="px-6 py-3">数量</th>
                          <th className="px-6 py-3">金额</th>
                          <th className="px-6 py-3">删除时间</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {deletedSales.map((item) => (
                          <tr key={item.id}>
                            <td className="px-6 py-3 text-slate-500">
                              {item.date ? new Date(item.date).toLocaleString('zh-CN') : '-'}
                            </td>
                            <td className="px-6 py-3 font-medium text-slate-700">
                              {products.find(p => p.id === item.product_id)?.name || '未知商品'}
                            </td>
                            <td className="px-6 py-3 text-slate-500">{item.quantity}</td>
                            <td className="px-6 py-3 text-emerald-600 font-bold">￥{Number(item.total_amount || 0).toFixed(2)}</td>
                            <td className="px-6 py-3 text-slate-500">
                              {item.deleted_at ? new Date(item.deleted_at).toLocaleString('zh-CN') : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}