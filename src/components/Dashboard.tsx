import React, { useMemo } from 'react';
import { useStore } from '../hooks/useStore';
import { TrendingUp, Users, ShoppingBag, AlertTriangle, PackageSearch } from 'lucide-react';

export function Dashboard({ store }: { store: ReturnType<typeof useStore> }) {
  const { sales, products } = store;

  const stats = useMemo(() => {
    const totalRevenue = sales.reduce((sum, sale) => sum + sale.totalAmount, 0);
    const totalOrders = sales.length;

    // Salesperson ranking
    const salespersonMap = new Map<string, number>();
    sales.forEach(sale => {
      const current = salespersonMap.get(sale.salesperson) || 0;
      salespersonMap.set(sale.salesperson, current + sale.totalAmount);
    });
    const topSalespeople = Array.from(salespersonMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount]) => ({ name, amount }));

    // Top products this month
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    
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
          name: product?.name || 'Unknown',
          quantity
        };
      });

    // Restock Prediction Logic
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const restockList = products.map(product => {
      // Calculate sales in last 30 days for this product
      const recentSales = sales.filter(sale => 
        sale.productId === product.id && 
        new Date(sale.date) >= thirtyDaysAgo
      );
      
      const totalSoldLast30Days = recentSales.reduce((sum, sale) => sum + sale.quantity, 0);
      const averageDailySales = totalSoldLast30Days / 30;
      
      // If average daily sales is 0, we don't need to restock based on prediction
      if (averageDailySales === 0) return null;

      const daysUntilEmpty = product.stock / averageDailySales;
      
      // If stock will run out in less than 7 days
      if (daysUntilEmpty < 7) {
        // Calculate amount needed for next 14 days
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
    }).filter(Boolean) as {
      id: string;
      name: string;
      currentStock: number;
      averageDailySales: string;
      daysRemaining: number;
      recommendedOrder: number;
    }[];

    return { totalRevenue, totalOrders, topSalespeople, topProducts, restockList };
  }, [sales, products]);

  return (
    <div className="space-y-6">
      <div className="p-6 bg-white rounded-2xl shadow-sm border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900">Dashboard</h2>
        <p className="text-slate-500 mt-1">Overview of your shop's performance</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="p-4 bg-emerald-100 text-emerald-600 rounded-xl">
            <TrendingUp className="w-8 h-8" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">Total Revenue</p>
            <p className="text-3xl font-bold text-slate-900">${stats.totalRevenue.toFixed(2)}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="p-4 bg-blue-100 text-blue-600 rounded-xl">
            <ShoppingBag className="w-8 h-8" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">Total Orders</p>
            <p className="text-3xl font-bold text-slate-900">{stats.totalOrders}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Salesperson Ranking */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-slate-400" />
            <h3 className="text-lg font-bold text-slate-900">Top Salespeople</h3>
          </div>
          <div className="p-6">
            {stats.topSalespeople.length > 0 ? (
              <div className="space-y-4">
                {stats.topSalespeople.map((person, index) => {
                  const maxAmount = stats.topSalespeople[0].amount;
                  const percentage = (person.amount / maxAmount) * 100;
                  return (
                    <div key={person.name} className="space-y-1">
                      <div className="flex justify-between text-sm font-medium">
                        <span className="text-slate-700">
                          {index + 1}. {person.name}
                        </span>
                        <span className="text-emerald-600">${person.amount.toFixed(2)}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2">
                        <div 
                          className="bg-emerald-500 h-2 rounded-full" 
                          style={{ width: `${percentage}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-slate-500 text-center py-4">No sales data yet.</p>
            )}
          </div>
        </div>

        {/* Top Products This Month */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-slate-400" />
            <h3 className="text-lg font-bold text-slate-900">Monthly Top 3 Products</h3>
          </div>
          <div className="p-0">
            {stats.topProducts.length > 0 ? (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                    <th className="px-6 py-3 font-medium">Rank</th>
                    <th className="px-6 py-3 font-medium">Product</th>
                    <th className="px-6 py-3 font-medium text-right">Units Sold</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stats.topProducts.map((product, index) => (
                    <tr key={index} className="hover:bg-slate-50/50">
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                          index === 0 ? 'bg-amber-100 text-amber-700' :
                          index === 1 ? 'bg-slate-200 text-slate-700' :
                          'bg-orange-100 text-orange-800'
                        }`}>
                          {index + 1}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-900">{product.name}</td>
                      <td className="px-6 py-4 text-right font-bold text-emerald-600">{product.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-slate-500 text-center py-10">No sales recorded this month.</p>
            )}
          </div>
        </div>
      </div>

      {/* Smart Restock Prediction */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center gap-2">
          <PackageSearch className="w-5 h-5 text-slate-400" />
          <h3 className="text-lg font-bold text-slate-900">Smart Restock Recommendations</h3>
        </div>
        <div className="p-0">
          {stats.restockList.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                    <th className="px-6 py-3 font-medium">Product</th>
                    <th className="px-6 py-3 font-medium">Current Stock</th>
                    <th className="px-6 py-3 font-medium">Avg Daily Sales</th>
                    <th className="px-6 py-3 font-medium">Est. Days Left</th>
                    <th className="px-6 py-3 font-medium text-right">Suggested Order (14 Days)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stats.restockList.map(item => (
                    <tr key={item.id} className="hover:bg-slate-50/50">
                      <td className="px-6 py-4 font-medium text-slate-900">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                          {item.name}
                        </div>
                      </td>
                      <td className="px-6 py-4 font-bold text-red-600">{item.currentStock}</td>
                      <td className="px-6 py-4 text-slate-600">{item.averageDailySales}/day</td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          {item.daysRemaining} days
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-bold text-emerald-600">
                        +{item.recommendedOrder} units
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-10 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 mb-3">
                <TrendingUp className="w-6 h-6" />
              </div>
              <p className="text-slate-900 font-medium">Stock levels are healthy</p>
              <p className="text-slate-500 text-sm mt-1">No immediate restock needed based on current sales velocity.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
