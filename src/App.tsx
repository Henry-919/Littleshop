import React, { useState } from 'react';
import { useStore } from './hooks/useStore';
import { Sidebar, TabType } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { POS } from './components/POS';
import { Inventory } from './components/Inventory';
import { SalesHistory } from './components/SalesHistory';
import { Analytics } from './components/Analytics';

function App() {
  const store = useStore();
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');

  // 根据侧边栏选择渲染对应的页面组件
  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard store={store} />;
      case 'pos':
        return <POS store={store} />;
      case 'inventory':
        return <Inventory store={store} />;
      case 'history':
        return <SalesHistory store={store} />;
      case 'analytics':
        return <Analytics />;
      default:
        return <Dashboard store={store} />;
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden font-sans">
      {/* 侧边导航栏 */}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* 主内容区域 */}
      <main className="flex-1 h-full overflow-hidden flex flex-col">
        {/* 顶部状态栏 - 可选：放置搜索或用户信息 */}
        <header className="h-16 bg-white border-b border-slate-100 flex items-center justify-between px-8 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-400">当前位置 /</span>
            <span className="text-sm font-bold text-slate-600">
              {activeTab === 'dashboard' && '经营看板'}
              {activeTab === 'pos' && '收银终端'}
              {activeTab === 'inventory' && '库存管理'}
              {activeTab === 'history' && '销售流水'}
              {activeTab === 'analytics' && '深度分析'}
            </span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs font-bold text-slate-900">管理员账号</p>
              <p className="text-[10px] text-emerald-500 font-medium">在线模式</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-slate-100 border-2 border-white shadow-sm flex items-center justify-center font-bold text-slate-400">
              AD
            </div>
          </div>
        </header>

        {/* 页面内容容器 */}
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-[#F8FAFC]">
          <div className="max-w-7xl mx-auto">
            {renderContent()}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;