import React, { useState, useEffect } from 'react';
import { AnalyticsData } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { TrendingUp, AlertTriangle, PackageSearch } from 'lucide-react';

export function Analytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);

  useEffect(() => {
    fetch('/api/analytics')
      .then(res => res.json())
      .then(d => setData(d));
  }, []);

  if (!data) return <div className="flex items-center justify-center h-full">Loading analytics...</div>;

  return (
    <div className="space-y-6 h-full overflow-y-auto pb-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Best Sellers Card */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-emerald-100 text-emerald-600 rounded-xl">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-slate-500 text-sm font-medium">Top Product This Month</h3>
              <p className="text-2xl font-bold text-slate-900">
                {data.bestSellers[0]?.name || 'N/A'}
              </p>
            </div>
          </div>
        </div>

        {/* Low Stock Alert */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-red-100 text-red-600 rounded-xl">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-slate-500 text-sm font-medium">Items Needing Restock</h3>
              <p className="text-2xl font-bold text-slate-900">
                {data.lowStock.length} items
              </p>
            </div>
          </div>
        </div>

        {/* Total Revenue 7 Days */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-blue-100 text-blue-600 rounded-xl">
              <PackageSearch className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-slate-500 text-sm font-medium">Revenue (Last 7 Days)</h3>
              <p className="text-2xl font-bold text-slate-900">
                ${data.dailySales.reduce((sum, day) => sum + day.revenue, 0).toFixed(2)}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Sales Chart */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Revenue Trend (Last 7 Days)</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.dailySales}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: '#64748b'}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b'}} tickFormatter={(value) => `$${value}`} />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: number) => [`$${value.toFixed(2)}`, 'Revenue']}
                />
                <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={3} dot={{r: 4, fill: '#10b981', strokeWidth: 2, stroke: '#fff'}} activeDot={{r: 6}} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Best Sellers Chart */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Top 5 Best Sellers (Monthly)</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.bestSellers} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{fill: '#64748b'}} />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{fill: '#64748b'}} width={100} />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  cursor={{fill: '#f1f5f9'}}
                />
                <Bar dataKey="total_sold" fill="#3b82f6" radius={[0, 4, 4, 0]} name="Units Sold" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Restock Prediction Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">Restock Recommendations</h3>
          <p className="text-sm text-slate-500 mt-1">Products with low stock that need immediate attention.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-sm uppercase tracking-wider">
                <th className="px-6 py-3 font-medium">Product</th>
                <th className="px-6 py-3 font-medium">Category</th>
                <th className="px-6 py-3 font-medium">Current Stock</th>
                <th className="px-6 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {data.lowStock.map(item => (
                <tr key={item.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-6 py-4 font-medium">{item.name}</td>
                  <td className="px-6 py-4 text-slate-500">{item.category}</td>
                  <td className="px-6 py-4 font-bold text-red-500">{item.stock}</td>
                  <td className="px-6 py-4">
                    <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-semibold">
                      {item.stock === 0 ? 'Out of Stock' : 'Low Stock'}
                    </span>
                  </td>
                </tr>
              ))}
              {data.lowStock.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-slate-500">All products are well stocked!</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
