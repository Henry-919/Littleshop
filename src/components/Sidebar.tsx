import React from 'react';
import { ShoppingCart, Package, BarChart3, History, LayoutDashboard, Store, Tags } from 'lucide-react';

// 统一 Tab 类型定义
export type TabType = 'dashboard' | 'pos' | 'inventory' | 'history' | 'analytics' | 'categories';

interface SidebarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
}

export function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  // 定义导航项，全部中文化并赋予清晰的语义
  const navItems = [
    { id: 'dashboard', label: '经营看板', icon: LayoutDashboard },
    { id: 'pos', label: '收银终端', icon: ShoppingCart },
    { id: 'inventory', label: '库存管理', icon: Package },
    { id: 'categories', label: '商品分类', icon: Tags },
    { id: 'history', label: '销售流水', icon: History },
    { id: 'analytics', label: '深度分析', icon: BarChart3 },
  ] as const;

  return (
    <div className="w-64 bg-slate-950 text-white flex flex-col h-full border-r border-slate-800/50 shadow-2xl">
      {/* Logo 区域 */}
      <div className="p-8">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500 rounded-lg">
            <Store className="w-6 h-6 text-slate-950" />
          </div>
          <h1 className="text-xl font-black tracking-tighter text-white">
            智铺助手 <span className="text-emerald-400">Pro</span>
          </h1>
        </div>
      </div>

      {/* 导航区域 */}
      <nav className="flex-1 px-4 space-y-1.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center justify-between group px-4 py-3.5 rounded-xl transition-all duration-200 relative
                ${isActive 
                  ? 'bg-emerald-500/10 text-emerald-400 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.2)]' 
                  : 'text-slate-400 hover:bg-slate-900 hover:text-white'
                }`}
            >
              <div className="flex items-center space-x-3 z-10">
                <Icon className={`w-5 h-5 transition-transform duration-300 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`} />
                <span className="font-bold tracking-wide">{item.label}</span>
              </div>

              {/* 激活状态的右侧小圆点 */}
              {isActive && (
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
              )}
              
              {/* 激活状态的左侧指示条 */}
              {isActive && (
                <div className="absolute left-0 top-3 bottom-3 w-1 bg-emerald-500 rounded-r-full" />
              )}
            </button>
          );
        })}
      </nav>

      {/* 底部信息 */}
      <div className="p-6">
        <div className="bg-slate-900/50 rounded-2xl p-4 border border-slate-800/50">
          <p className="text-[10px] text-slate-500 uppercase tracking-[0.2em] font-black mb-1">系统状态</p>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-slate-300 font-medium">云端连接正常</span>
          </div>
        </div>
        <p className="mt-4 text-[10px] text-slate-600 text-center font-medium opacity-50">
          &copy; 2026 智铺管理系统 v2.4
        </p>
      </div>
    </div>
  );
}