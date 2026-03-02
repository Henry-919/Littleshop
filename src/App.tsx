import React, { useCallback, useEffect, useState } from 'react';
import { useStore } from './hooks/useStore';
import { supabase } from './lib/supabase';
import { Sidebar, TabType } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { POS } from './components/POS';
import { Inventory } from './components/Inventory';
import { SalesHistory } from './components/SalesHistory';
import { Analytics } from './components/Analytics';
import { Categories } from './components/Categories';
import { Stores } from './components/Stores';
import { Returns } from './components/Returns';
import { Menu } from 'lucide-react';

function App() {
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [storeId, setStoreId] = useState<string>('');
  const store = useStore(storeId || undefined);
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const loadStores = useCallback(async () => {
    const { data, error } = await supabase
      .from('stores')
      .select('id, name')
      .is('deleted_at', null)
      .order('name');
    if (error) {
      console.error('Failed to load stores:', error);
      return;
    }
    const list = data || [];
    setStores(list);
    if (!storeId && list.length > 0) {
      setStoreId(list[0].id);
      return;
    }
    if (storeId && !list.some(item => item.id === storeId)) {
      setStoreId(list[0]?.id || '');
    }
  }, [storeId]);

  useEffect(() => {
    loadStores();
  }, [loadStores]);

  // 根据侧边栏选择渲染对应的页面组件
  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard store={store} storeId={storeId} />;
      case 'pos':
        return <POS store={store} />;
      case 'inventory':
        return <Inventory store={store} storeId={storeId} />;
      case 'returns':
        return <Returns store={store} storeId={storeId} />;
      case 'categories':
        return <Categories store={store} storeId={storeId} />;
      case 'stores':
        return <Stores onStoresChanged={loadStores} />;
      case 'history':
        return <SalesHistory store={store} storeId={storeId} />;
      case 'analytics':
        return <Analytics storeId={storeId} />;
      default:
        return <Dashboard store={store} storeId={storeId} />;
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden font-sans">
      {/* 侧边导航栏 */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      {/* 主内容区域 */}
      <main className="flex-1 h-full overflow-hidden flex flex-col">
        {/* 顶部状态栏 - 可选：放置搜索或用户信息 */}
        <header className="h-16 bg-white border-b border-slate-100 flex items-center justify-between px-4 md:px-8 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-2 bg-slate-100 text-slate-700 rounded-lg"
              aria-label="打开菜单"
            >
              <Menu className="w-4 h-4" />
            </button>
            <span className="hidden md:inline text-sm font-medium text-slate-400">当前位置 /</span>
            <span className="text-xs md:text-sm font-bold text-slate-600">
              {activeTab === 'dashboard' && '经营看板'}
              {activeTab === 'pos' && '收银终端'}
              {activeTab === 'inventory' && '库存管理'}
              {activeTab === 'returns' && '退货管理'}
              {activeTab === 'categories' && '商品分类'}
              {activeTab === 'stores' && '门店管理'}
              {activeTab === 'history' && '销售流水'}
              {activeTab === 'analytics' && '深度分析'}
            </span>
          </div>
          
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-xs text-slate-400">门店</span>
              <select
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                className="max-w-[120px] sm:max-w-none px-2 py-1 text-xs border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {stores.length === 0 && (
                  <option value="" disabled>暂无门店</option>
                )}
                {stores.map((storeItem) => (
                  <option key={storeItem.id} value={storeItem.id}>{storeItem.name}</option>
                ))}
              </select>
            </div>
            <div className="hidden md:block text-right">
              <p className="text-xs font-bold text-slate-900">管理员账号</p>
              <p className="text-[10px] text-emerald-500 font-medium">在线模式</p>
            </div>
            <div className="hidden md:flex w-10 h-10 rounded-full bg-slate-100 border-2 border-white shadow-sm items-center justify-center font-bold text-slate-400">
              AD
            </div>
          </div>
        </header>

        {/* 页面内容容器 */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar bg-[#F8FAFC]">
          <div className="max-w-7xl mx-auto">
            {renderContent()}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;