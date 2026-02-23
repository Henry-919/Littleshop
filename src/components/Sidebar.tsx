import React from 'react';
import { ShoppingCart, Package, BarChart3, History, LayoutDashboard } from 'lucide-react';

export type TabType = 'dashboard' | 'pos' | 'inventory' | 'history' | 'analytics';

interface SidebarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
}

export function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'pos', label: 'Point of Sale', icon: ShoppingCart },
    { id: 'inventory', label: 'Inventory', icon: Package },
    { id: 'history', label: 'Sales History', icon: History },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  ] as const;

  return (
    <div className="w-64 bg-slate-900 text-white flex flex-col h-full">
      <div className="p-6">
        <h1 className="text-2xl font-bold tracking-tight text-emerald-400">ShopManager Pro</h1>
      </div>
      <nav className="flex-1 px-4 space-y-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${
                activeTab === item.id
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="p-4 text-xs text-slate-500 text-center">
        &copy; 2026 ShopManager
      </div>
    </div>
  );
}
