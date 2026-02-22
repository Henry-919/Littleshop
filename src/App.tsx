import React, { useState } from 'react';
import { POS } from './components/POS';
import { Inventory } from './components/Inventory';
import { SalesHistory } from './components/SalesHistory';
import { Dashboard } from './components/Dashboard';
import { ReceiptScanner } from './components/ReceiptScanner';
import { Categories } from './components/Categories';
import { useStore } from './hooks/useStore';
import { ShoppingCart, Package, History, Store, LayoutDashboard, Camera, Tags } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'pos' | 'inventory' | 'categories' | 'history' | 'scan'>('dashboard');
  const store = useStore();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* Sidebar */}
      <div className="w-full md:w-64 bg-slate-900 text-white flex flex-col">
        <div className="p-6 flex items-center gap-3">
          <Store className="w-8 h-8 text-emerald-400" />
          <h1 className="text-xl font-bold tracking-tight text-emerald-400">ShopManager</h1>
        </div>
        <nav className="flex-1 px-4 space-y-2 overflow-y-auto">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${
              activeTab === 'dashboard' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span className="font-medium">Dashboard</span>
          </button>
          <button
            onClick={() => setActiveTab('pos')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${
              activeTab === 'pos' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <ShoppingCart className="w-5 h-5" />
            <span className="font-medium">Point of Sale</span>
          </button>
          <button
            onClick={() => setActiveTab('scan')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${
              activeTab === 'scan' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Camera className="w-5 h-5" />
            <span className="font-medium">Scan Receipt</span>
          </button>
          <button
            onClick={() => setActiveTab('inventory')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${
              activeTab === 'inventory' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Package className="w-5 h-5" />
            <span className="font-medium">Inventory (库存)</span>
          </button>
          <button
            onClick={() => setActiveTab('categories')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${
              activeTab === 'categories' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Tags className="w-5 h-5" />
            <span className="font-medium">Categories (类目)</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-colors ${
              activeTab === 'history' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <History className="w-5 h-5" />
            <span className="font-medium">Sales History</span>
          </button>
        </nav>
      </div>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto h-screen">
        {activeTab === 'dashboard' && <Dashboard store={store} />}
        {activeTab === 'pos' && <POS store={store} />}
        {activeTab === 'scan' && <ReceiptScanner store={store} />}
        {activeTab === 'inventory' && <Inventory store={store} />}
        {activeTab === 'categories' && <Categories store={store} />}
        {activeTab === 'history' && <SalesHistory store={store} />}
      </main>
    </div>
  );
}
