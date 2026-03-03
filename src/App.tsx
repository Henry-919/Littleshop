import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from './hooks/useStore';
import { supabase } from './lib/supabase';
import { Sidebar, TabType } from './components/Sidebar';
import { Menu } from 'lucide-react';
import { subscribeNavigate } from './lib/navigation';

const Dashboard = lazy(() => import('./components/Dashboard').then((m) => ({ default: m.Dashboard })));
const POS = lazy(() => import('./components/POS').then((m) => ({ default: m.POS })));
const Inventory = lazy(() => import('./components/Inventory').then((m) => ({ default: m.Inventory })));
const SalesHistory = lazy(() => import('./components/SalesHistory').then((m) => ({ default: m.SalesHistory })));
const Analytics = lazy(() => import('./components/Analytics').then((m) => ({ default: m.Analytics })));
const Categories = lazy(() => import('./components/Categories').then((m) => ({ default: m.Categories })));
const Stores = lazy(() => import('./components/Stores').then((m) => ({ default: m.Stores })));
const Returns = lazy(() => import('./components/Returns').then((m) => ({ default: m.Returns })));

const TAB_TITLES: Record<TabType, string> = {
  dashboard: '经营看板',
  pos: '收银终端',
  inventory: '库存管理',
  returns: '退货管理',
  categories: '商品分类',
  stores: '门店管理',
  history: '销售流水',
  analytics: '深度分析'
};

function PageLoadingFallback() {
  return (
    <div className="ui-card p-10 flex flex-col items-center justify-center gap-3 text-slate-500 min-h-[240px]">
      <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
      <p className="text-sm">页面加载中...</p>
    </div>
  );
}

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

  useEffect(() => {
    const unsubscribe = subscribeNavigate(({ tab }) => {
      setActiveTab(tab);
      setMobileMenuOpen(false);
    });
    return unsubscribe;
  }, []);

  const content = useMemo(() => {
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
  }, [activeTab, loadStores, store, storeId]);

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
              className="md:hidden ui-btn-muted !p-2 !rounded-lg"
              aria-label="打开菜单"
            >
              <Menu className="w-4 h-4" />
            </button>
            <span className="hidden md:inline text-sm font-medium text-slate-400">当前位置 /</span>
            <span className="text-xs md:text-sm font-bold text-slate-600">{TAB_TITLES[activeTab]}</span>
          </div>
          
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-xs text-slate-400">门店</span>
              <select
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                className="ui-select max-w-[120px] sm:max-w-none !py-1.5 !text-xs"
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
        <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar bg-slate-50">
          <Suspense fallback={<PageLoadingFallback />}>
            <section key={activeTab} className="max-w-7xl mx-auto page-enter">
              {content}
            </section>
          </Suspense>
        </div>
      </main>
    </div>
  );
}

export default App;