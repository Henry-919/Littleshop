import React, { useMemo } from 'react';
import { useStore } from '../hooks/useStore';
import { TrendingUp, Users, ShoppingBag, AlertTriangle, PackageSearch, Medal } from 'lucide-react';

export function Dashboard({ store }: { store: ReturnType<typeof useStore> }) {
  const { sales, products } = store;

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