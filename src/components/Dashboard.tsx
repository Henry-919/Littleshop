import React, { useMemo, useEffect, useState, useRef } from 'react';
import { useStore } from '../hooks/useStore';
import { TrendingUp, Users, ShoppingBag, AlertTriangle, PackageSearch, Medal } from 'lucide-react';
import { supabase } from '../lib/supabase';

export function Dashboard({ store, storeId }: { store: ReturnType<typeof useStore>; storeId?: string }) {
  const { sales, products } = store;

  type PaymentInput = { card: string; cash: string; transfer: string };

  const stats = useMemo(() => {
    const totalRevenue = sales.reduce((sum, sale) => sum + sale.totalAmount, 0);
    const totalOrders = sales.length;

    // 销售员业绩排行
    const salespersonMap = new Map<string, number>();
    sales.forEach(sale => {
      const current = salespersonMap.get(sale.salesperson) || 0;
      salespersonMap.set(sale.salesperson, current + sale.totalAmount);
    });
    const topSalespeople = Array.from(salespersonMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount]) => ({ name, amount }));

    // 本月热门商品
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    const productSalesMap = new Map<string, number>();
    sales.forEach(sale => {
      const saleDate = new Date(sale.date);
      if (saleDate.getMonth() === currentMonth && saleDate.getFullYear() === currentYear) {
        const current = productSalesMap.get(sale.productId) || 0;
        productSalesMap.set(sale.productId, current + sale.quantity);
      }
    });

    const topProducts = Array.from(productSalesMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([productId, quantity]) => {
        const product = products.find(p => p.id === productId);
        return {
          name: product?.name || '未知商品',
          quantity
        };
      });

    // 智能补货算法 (基于过去30天销量预测)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const restockList = products.map(product => {
      const recentSales = sales.filter(sale => 
        sale.productId === product.id && 
        new Date(sale.date) >= thirtyDaysAgo
      );
      
      const totalSoldLast30Days = recentSales.reduce((sum, sale) => sum + sale.quantity, 0);
      const averageDailySales = totalSoldLast30Days / 30;
      
      if (averageDailySales === 0) return null;

      const daysUntilEmpty = product.stock / averageDailySales;
      
      // 如果库存预计撑不到 7 天
      if (daysUntilEmpty < 7) {
        const targetStockFor14Days = Math.ceil(averageDailySales * 14);
        const recommendedOrder = Math.max(0, targetStockFor14Days - product.stock);
        
        if (recommendedOrder > 0) {
          return {
            id: product.id,
            name: product.name,
            currentStock: product.stock,
            averageDailySales: averageDailySales.toFixed(1),
            daysRemaining: Math.floor(daysUntilEmpty),
            recommendedOrder
          };
        }
      }
      return null;
    }).filter(Boolean) as any[];

    return { totalRevenue, totalOrders, topSalespeople, topProducts, restockList };
  }, [sales, products]);

  const monthlySales = useMemo(() => {
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const toMonthKey = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
    const toDayKey = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

    const map = new Map<string, { total: number; daily: Map<string, number> }>();
    for (const sale of sales) {
      const date = new Date(sale.date);
      if (Number.isNaN(date.getTime())) continue;
      const monthKey = toMonthKey(date);
      const dayKey = toDayKey(date);
      if (!map.has(monthKey)) {
        map.set(monthKey, { total: 0, daily: new Map() });
      }
      const entry = map.get(monthKey)!;
      entry.total += sale.totalAmount || 0;
      entry.daily.set(dayKey, (entry.daily.get(dayKey) || 0) + (sale.totalAmount || 0));
    }

    const months = Array.from(map.entries())
      .map(([monthKey, data]) => ({
        monthKey,
        total: data.total,
        daily: Array.from(data.daily.entries())
          .map(([date, amount]) => ({ date, amount }))
          .sort((a, b) => a.date.localeCompare(b.date))
      }))
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey));

    return months;
  }, [sales]);

  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [paymentInputs, setPaymentInputs] = useState<Record<string, PaymentInput>>({});
  const saveTimers = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!selectedMonth && monthlySales.length > 0) {
      setSelectedMonth(monthlySales[0].monthKey);
    }
  }, [monthlySales, selectedMonth]);

  useEffect(() => {
    const loadPayments = async () => {
      if (!selectedMonth) return;
      const month = monthlySales.find(m => m.monthKey === selectedMonth);
      if (!month) return;

      const start = `${selectedMonth}-01`;
      const endDate = new Date(`${selectedMonth}-01T00:00:00`);
      endDate.setMonth(endDate.getMonth() + 1);
      endDate.setDate(0);
      const end = `${selectedMonth}-${String(endDate.getDate()).padStart(2, '0')}`;

      const nextInputs: Record<string, PaymentInput> = {};
      month.daily.forEach((day) => {
        nextInputs[day.date] = { card: '', cash: '', transfer: '' };
      });

      try {
        if (!storeId) {
          setPaymentInputs(nextInputs);
          return;
        }

        const { data, error } = await supabase
          .from('daily_payments')
          .select('date, card_amount, cash_amount, transfer_amount')
          .eq('store_id', storeId)
          .gte('date', start)
          .lte('date', end);

        if (error) {
          console.error('Failed to load daily payments:', error);
        } else if (data) {
          data.forEach((row: any) => {
            const dateKey = row.date;
            if (nextInputs[dateKey]) {
              nextInputs[dateKey] = {
                card: row.card_amount?.toString() ?? '',
                cash: row.cash_amount?.toString() ?? '',
                transfer: row.transfer_amount?.toString() ?? ''
              };
            }
          });
        }
      } catch (err) {
        console.error('Failed to load daily payments:', err);
      }

      setPaymentInputs(nextInputs);
    };

    loadPayments();
  }, [selectedMonth, monthlySales]);

  const scheduleSavePayment = (date: string, input: PaymentInput) => {
    if (!storeId) return;
    if (saveTimers.current[date]) {
      window.clearTimeout(saveTimers.current[date]);
    }

    saveTimers.current[date] = window.setTimeout(async () => {
      const payload = {
        date,
        card_amount: Number(input.card) || 0,
        cash_amount: Number(input.cash) || 0,
        transfer_amount: Number(input.transfer) || 0,
        store_id: storeId
      };

      const { error } = await supabase
        .from('daily_payments')
        .upsert(payload, { onConflict: 'store_id,date' });

      if (error) {
        console.error('Failed to save daily payment:', error);
      }
    }, 500);
  };

  const selectedMonthData = monthlySales.find(m => m.monthKey === selectedMonth) || null;
  const formatMonthLabel = (monthKey: string) => {
    const [year, month] = monthKey.split('-');
    return `${year}年${month}月`;
  };

  return (
    <div className="space-y-6 pb-10">
      {/* 欢迎头部 */}
      <div className="p-6 bg-slate-900 rounded-2xl shadow-lg text-white relative overflow-hidden">
        <div className="relative z-10">
          <h2 className="text-2xl font-bold">经营看板</h2>
          <p className="text-slate-400 mt-1 text-sm">今日经营状况与智能库存预测</p>
        </div>
        <PackageSearch className="absolute right-[-20px] bottom-[-20px] w-40 h-40 text-white/5 rotate-12" />
      </div>

      {/* 核心指标卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-5 hover:shadow-md transition-shadow">
          <div className="p-4 bg-emerald-50 text-emerald-600 rounded-2xl">
            <TrendingUp className="w-8 h-8" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">总营收额</p>
            <p className="text-3xl font-black text-slate-900">￥{stats.totalRevenue.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-5 hover:shadow-md transition-shadow">
          <div className="p-4 bg-indigo-50 text-indigo-600 rounded-2xl">
            <ShoppingBag className="w-8 h-8" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">累计订单</p>
            <p className="text-3xl font-black text-slate-900">{stats.totalOrders} <span className="text-sm font-normal text-slate-400">单</span></p>
          </div>
        </div>
      </div>

      {/* 总营收额模块 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-500" />
            <h3 className="font-bold text-slate-900">总营收额</h3>
          </div>
          <span className="text-xs text-slate-400">点击月份查看明细</span>
        </div>
        <div className="p-6 space-y-6">
          {monthlySales.length === 0 ? (
            <div className="text-slate-400 text-sm text-center py-6">暂无销售数据</div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {monthlySales.map((month) => (
                  <button
                    key={month.monthKey}
                    onClick={() => setSelectedMonth(month.monthKey)}
                    className={`text-left p-4 rounded-2xl border transition-all shadow-sm hover:shadow-md
                      ${selectedMonth === month.monthKey
                        ? 'border-emerald-500 bg-emerald-50'
                        : 'border-slate-100 bg-white'
                      }`}
                  >
                    <div className="text-xs text-slate-400">{formatMonthLabel(month.monthKey)}</div>
                    <div className="text-xl font-black text-slate-900 mt-1">
                      ￥{month.total.toLocaleString()}
                    </div>
                  </button>
                ))}
              </div>

              {selectedMonthData && (
                <div className="rounded-2xl border border-slate-100 overflow-hidden">
                  <div className="p-4 bg-slate-50/50 flex items-center justify-between">
                    <div className="font-bold text-slate-900">
                      {formatMonthLabel(selectedMonthData.monthKey)}每日销售额
                    </div>
                    <div className="text-sm text-slate-500">
                      本月合计：￥{selectedMonthData.total.toLocaleString()}
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="bg-white text-slate-400 text-xs uppercase tracking-wider">
                          <th className="px-6 py-3">日期</th>
                          <th className="px-6 py-3">当日销售额</th>
                          <th className="px-6 py-3">刷卡收款</th>
                          <th className="px-6 py-3">现金收款</th>
                          <th className="px-6 py-3">手机转账</th>
                          <th className="px-6 py-3">校验</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedMonthData.daily.map((day) => {
                          const inputs = paymentInputs[day.date] || { card: '', cash: '', transfer: '' };
                          const card = Number(inputs.card) || 0;
                          const cash = Number(inputs.cash) || 0;
                          const transfer = Number(inputs.transfer) || 0;
                          const sum = card + cash + transfer;
                          const matched = Math.abs(sum - day.amount) < 0.01;
                          return (
                            <tr key={day.date} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-6 py-3 text-slate-600 font-medium">{day.date}</td>
                              <td className="px-6 py-3 font-black text-emerald-600">￥{day.amount.toFixed(2)}</td>
                              <td className="px-6 py-3">
                                <input
                                  type="number"
                                  value={inputs.card}
                                  onChange={(e) => {
                                    const next = { ...paymentInputs, [day.date]: { ...inputs, card: e.target.value } };
                                    setPaymentInputs(next);
                                    scheduleSavePayment(day.date, next[day.date]);
                                  }}
                                  className="w-28 px-2 py-1 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                  placeholder="0"
                                />
                              </td>
                              <td className="px-6 py-3">
                                <input
                                  type="number"
                                  value={inputs.cash}
                                  onChange={(e) => {
                                    const next = { ...paymentInputs, [day.date]: { ...inputs, cash: e.target.value } };
                                    setPaymentInputs(next);
                                    scheduleSavePayment(day.date, next[day.date]);
                                  }}
                                  className="w-28 px-2 py-1 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                  placeholder="0"
                                />
                              </td>
                              <td className="px-6 py-3">
                                <input
                                  type="number"
                                  value={inputs.transfer}
                                  onChange={(e) => {
                                    const next = { ...paymentInputs, [day.date]: { ...inputs, transfer: e.target.value } };
                                    setPaymentInputs(next);
                                    scheduleSavePayment(day.date, next[day.date]);
                                  }}
                                  className="w-28 px-2 py-1 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                  placeholder="0"
                                />
                              </td>
                              <td className="px-6 py-3">
                                <span className={`text-xs font-bold px-2 py-1 rounded-full ${matched ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                                  {matched ? '已平衡' : `差额 ￥${(day.amount - sum).toFixed(2)}`}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 销售精英榜 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-500" />
              <h3 className="font-bold text-slate-900">销售表现排行</h3>
            </div>
          </div>
          <div className="p-6">
            {stats.topSalespeople.length > 0 ? (
              <div className="space-y-5">
                {stats.topSalespeople.map((person, index) => {
                  const maxAmount = stats.topSalespeople[0].amount;
                  const percentage = (person.amount / maxAmount) * 100;
                  return (
                    <div key={person.name} className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="font-bold text-slate-700">{index + 1}. {person.name}</span>
                        <span className="font-mono font-bold text-emerald-600">￥{person.amount.toLocaleString()}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div 
                          className="bg-gradient-to-r from-indigo-500 to-emerald-500 h-2 rounded-full transition-all duration-1000" 
                          style={{ width: `${percentage}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-slate-400 text-center py-6 text-sm italic">暂无销售数据</p>
            )}
          </div>
        </div>

        {/* 本月热销 Top 3 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-2">
              <Medal className="w-5 h-5 text-amber-500" />
              <h3 className="font-bold text-slate-900">本月热销商品</h3>
            </div>
          </div>
          <div className="p-0">
            {stats.topProducts.length > 0 ? (
              <table className="w-full text-left">
                <tbody className="divide-y divide-slate-100">
                  {stats.topProducts.map((product, index) => (
                    <tr key={index} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold
                          ${index === 0 ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
                          {index + 1}
                        </div>
                      </td>
                      <td className="px-2 py-4 font-bold text-slate-800">{product.name}</td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-xs text-slate-400 mr-2">销量</span>
                        <span className="font-black text-indigo-600">{product.quantity}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-10 text-center text-slate-400 text-sm">本月尚未产生订单</div>
            )}
          </div>
        </div>
      </div>

      {/* 智能补货预警系统 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden ring-2 ring-rose-500/5">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-rose-50/30">
          <div className="flex items-center gap-2 text-rose-600">
            <AlertTriangle className="w-5 h-5 animate-pulse" />
            <h3 className="font-black">智能补货建议</h3>
          </div>
          <span className="text-[10px] font-bold bg-rose-100 text-rose-600 px-2 py-0.5 rounded-full uppercase tracking-tighter">AI 预测系统</span>
        </div>
        <div className="p-0">
          {stats.restockList.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-400 text-[10px] uppercase font-bold tracking-widest">
                    <th className="px-6 py-4">紧缺商品</th>
                    <th className="px-6 py-4 text-center">当前库存</th>
                    <th className="px-6 py-4 text-center">预计可用</th>
                    <th className="px-6 py-4 text-right">建议补货量 (14天)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {stats.restockList.map(item => (
                    <tr key={item.id} className="hover:bg-rose-50/20 group transition-colors">
                      <td className="px-6 py-4">
                        <span className="font-bold text-slate-800">{item.name}</span>
                        <div className="text-[10px] text-slate-400">日均销量: {item.averageDailySales} 件</div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="px-2 py-1 bg-slate-100 rounded-md font-mono font-bold text-slate-600">{item.currentStock}</span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-black
                          ${item.daysRemaining <= 2 ? 'bg-rose-100 text-rose-600 animate-bounce' : 'bg-orange-100 text-orange-600'}`}>
                          约 {item.daysRemaining} 天
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="text-emerald-600 font-black text-lg">+{item.recommendedOrder}</div>
                        <div className="text-[10px] text-slate-300">件</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <TrendingUp className="w-8 h-8" />
              </div>
              <p className="text-slate-800 font-bold">库存状态非常健康</p>
              <p className="text-slate-400 text-sm mt-1">根据过去30天的销量预测，目前没有商品急需补货。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}