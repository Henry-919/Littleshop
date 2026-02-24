import React, { useState } from 'react';
import { useStore } from '../hooks/useStore';
import { Trash2, History, ReceiptText, User, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

export function SalesHistory({ store, storeId }: { store: ReturnType<typeof useStore>; storeId?: string }) {
  const { sales, products, deleteSale } = store;
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedSales, setDeletedSales] = useState<any[]>([]);
  const [deletedLoading, setDeletedLoading] = useState(false);

  const getProductName = (id: string) => {
    return products.find(p => p.id === id)?.name || '未知商品';
  };

  const handleDelete = async (saleId: string, productId: string, quantity: number) => {
    if (window.confirm('确定要撤销这条销售记录吗？\n撤销后该商品的库存将自动还原。')) {
      await deleteSale(saleId);
    }
  };

  // 按照时间倒序排列，最新的排在最前面
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

  return (
    <div className="space-y-6">
      {/* 头部信息 */}
      <div className="p-6 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-amber-100 text-amber-600 rounded-xl">
            <History className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">销售流水</h2>
            <p className="text-slate-500 mt-1">查看并管理近期的所有交易记录</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:block text-right">
            <p className="text-xs text-slate-400 uppercase tracking-widest font-bold">总交易数</p>
            <p className="text-2xl font-black text-slate-900">{sales.length}</p>
          </div>
          <button
            onClick={async () => {
              setShowDeleted(true);
              await loadDeletedSales();
            }}
            className="px-3 py-2 bg-slate-900 text-white hover:bg-slate-800 rounded-xl font-bold transition-all border border-slate-900 shadow-sm text-sm"
          >
            查看删除记录
          </button>
        </div>
      </div>

      {/* 表格区域 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
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
              {sortedSales.map(sale => {
                const productId = sale.productId;
                const totalAmount = sale.totalAmount || 0;
                const date = sale.date;

                return (
                  <tr key={sale.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-4 text-slate-500 whitespace-nowrap">
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
                        <span className="font-bold text-slate-800">{getProductName(productId)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 bg-slate-100 rounded text-slate-600 font-mono">
                        {sale.quantity}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-black text-emerald-600">
                      ￥{Number(totalAmount).toFixed(2)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5 text-slate-500">
                        <User className="w-3.5 h-3.5" />
                        {sale.salesperson || '系统默认'}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleDelete(sale.id, productId, sale.quantity)}
                        className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                        title="撤销此单"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
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

      {showDeleted && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden border border-slate-100">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">删除记录 - 销售</h3>
              <button
                onClick={() => setShowDeleted(false)}
                className="p-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6">
              {deletedLoading ? (
                <div className="text-slate-400 text-sm">加载中...</div>
              ) : deletedSales.length === 0 ? (
                <div className="text-slate-400 text-sm">暂无删除记录</div>
              ) : (
                <div className="overflow-x-auto">
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
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}