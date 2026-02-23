import React, { useState, useEffect } from 'react';
import { AnalyticsData } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { TrendingUp, AlertTriangle, PackageSearch, Loader2 } from 'lucide-react';

export function Analytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch('/api/analytics')
      .then(res => res.json())
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
      <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
      <p>正在深度分析数据...</p>
    </div>
  );

  if (!data) return <div className="flex items-center justify-center h-full text-slate-500">暂无分析数据</div>;

  return (
    <div className="space-y-6 h-full overflow-y-auto pb-6 custom-scrollbar">
      {/* 顶部统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* 本月销冠 */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-emerald-100 text-emerald-600 rounded-xl">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-slate-500 text-sm font-medium">本月销售冠军</h3>
              <p className="text-xl font-bold text-slate-900 truncate max-w-[180px]">
                {data.bestSellers[0]?.name || '暂无数据'}
              </p>
            </div>
          </div>
        </div>

        {/* 库存预警 */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-rose-100 text-rose-600 rounded-xl">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-slate-500 text-sm font-medium">待补货商品</h3>
              <p className="text-2xl font-black text-slate-900">
                {data.lowStock.length} <span className="text-sm font-normal text-slate-400">项</span>
              </p>
            </div>
          </div>
        </div>

        {/* 7日营收 */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 text-blue-600 rounded-xl">
              <PackageSearch className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-slate-500 text-sm font-medium">近7日总营收</h3>
              <p className="text-2xl font-black text-slate-900">
                ￥{data.dailySales.reduce((sum, day) => sum + day.revenue, 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 图表区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 营收趋势图 */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-slate-900">营收走势 (过去7天)</h3>
            <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded">实时更新</span>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.dailySales}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} tickFormatter={(value) => `￥${value}`} />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: number) => [`￥${value.toFixed(2)}`, '当日营收']}
                />
                <Line 
                  type="monotone" 
                  dataKey="revenue" 
                  stroke="#10b981" 
                  strokeWidth={4} 
                  dot={{r: 4, fill: '#10b981', strokeWidth: 2, stroke: '#fff'}} 
                  activeDot={{r: 6, strokeWidth: 0}} 
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 销量排行榜 */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 mb-6">本月销量 Top 5</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.bestSellers} layout="vertical" margin={{ left: 30, right: 30 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" hide />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{fill: '#475569', fontSize: 12}} 
                  width={80} 
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  cursor={{fill: '#f8fafc'}}
                  formatter={(value: number) => [`${value} 件`, '累计销量']}
                />
                <Bar dataKey="total_sold" fill="#3b82f6" radius={[0, 6, 6, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 补货建议表格 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">补货预警清单</h3>
          <p className="text-sm text-slate-500 mt-1">系统根据当前库存自动筛选出的紧缺商品。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 text-slate-500 text-xs uppercase tracking-wider">
                <th className="px-6 py-4 font-semibold">商品名称</th>
                <th className="px-6 py-4 font-semibold">所属分类</th>
                <th className="px-6 py-4 font-semibold">当前库存</th>
                <th className="px-6 py-4 font-semibold">状态</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {data.lowStock.map(item => (
                <tr key={item.id} className="border-b border-slate-50 hover:bg-slate-50/30 transition-colors">
                  <td className="px-6 py-4 font-bold text-slate-700">{item.name}</td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 bg-slate-100 text-slate-500 rounded text-[11px]">
                      {item.category || '未分类'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`font-mono font-bold ${item.stock === 0 ? 'text-rose-600' : 'text-amber-600'}`}>
                      {item.stock}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${item.stock === 0 ? 'bg-rose-500 animate-pulse' : 'bg-amber-500'}`}></span>
                      <span className={`font-medium ${item.stock === 0 ? 'text-rose-600' : 'text-amber-600'}`}>
                        {item.stock === 0 ? '已售罄' : '库存紧张'}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
              {data.lowStock.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <PackageSearch className="w-10 h-10 opacity-20" />
                      <p>太棒了！目前没有商品处于低库存状态。</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}