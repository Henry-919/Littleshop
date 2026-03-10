import React from 'react';
import {
  BarChart3,
  Building2,
  History,
  LayoutDashboard,
  Package,
  RotateCcw,
  ShoppingCart,
  Store,
  Tags,
  X
} from 'lucide-react';

export type TabType = 'dashboard' | 'pos' | 'inventory' | 'returns' | 'history' | 'analytics' | 'categories' | 'stores';

interface SidebarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  canEdit?: boolean;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
  storeName?: string;
  storeStats?: {
    productCount: number;
    salesCount: number;
    alertCount: number;
  };
}

type NavItem = {
  id: TabType;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
  section: 'workspace' | 'manage';
};

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: '经营看板', description: '查看今日营收、预警和重点数据', icon: LayoutDashboard, section: 'workspace' },
  { id: 'pos', label: '收银终端', description: '快速录入销售并自动匹配商品', icon: ShoppingCart, section: 'workspace' },
  { id: 'inventory', label: '库存管理', description: '编辑库存、调货和入库记录', icon: Package, section: 'workspace' },
  { id: 'returns', label: '退货管理', description: '登记退货并自动回补库存', icon: RotateCcw, section: 'workspace' },
  { id: 'history', label: '销售流水', description: '查看历史记录、筛选和导出', icon: History, section: 'workspace' },
  { id: 'analytics', label: '深度分析', description: '查看趋势、结构和经营分析', icon: BarChart3, section: 'manage' },
  { id: 'categories', label: '商品分类', description: '维护分类和商品结构', icon: Tags, section: 'manage' },
  { id: 'stores', label: '门店管理', description: '切换和维护门店信息', icon: Building2, section: 'manage' },
];

const formatBadge = (value: number) => (value > 99 ? '99+' : String(value));

export function Sidebar({
  activeTab,
  setActiveTab,
  canEdit = false,
  mobileOpen = false,
  onCloseMobile,
  storeName,
  storeStats
}: SidebarProps) {
  const sections: Array<{ key: NavItem['section']; title: string; items: NavItem[] }> = [
    { key: 'workspace', title: '业务导航', items: NAV_ITEMS.filter((item) => item.section === 'workspace') },
    { key: 'manage', title: '设置与分析', items: NAV_ITEMS.filter((item) => item.section === 'manage') },
  ];

  const getBadge = (item: NavItem) => {
    if (!storeStats) return null;
    if (item.id === 'inventory' && storeStats.alertCount > 0) return `${formatBadge(storeStats.alertCount)} 预警`;
    if (item.id === 'history' && storeStats.salesCount > 0) return `${formatBadge(storeStats.salesCount)} 单`;
    return null;
  };

  const renderNav = (isMobile = false) => (
    <>
      <div className="p-5 pb-4 border-b border-white/5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-emerald-300/70 font-black">LittleShop</p>
              <h1 className="text-lg font-black tracking-tight text-white">智铺助手 Pro</h1>
            </div>
          </div>

          {isMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
              aria-label="关闭导航"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="mt-4 rounded-3xl border border-emerald-400/10 bg-gradient-to-br from-emerald-500/12 via-slate-900 to-slate-950 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="text-[10px] uppercase tracking-[0.25em] text-slate-400 font-black">当前门店</div>
          <div className="mt-2 text-lg font-black text-white">{storeName || '未选择门店'}</div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-white/5 bg-white/5 px-3 py-2">
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">商品</div>
              <div className="mt-1 text-base font-black text-white">{storeStats?.productCount ?? 0}</div>
            </div>
            <div className="rounded-2xl border border-white/5 bg-white/5 px-3 py-2">
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">订单</div>
              <div className="mt-1 text-base font-black text-white">{storeStats?.salesCount ?? 0}</div>
            </div>
            <div className="rounded-2xl border border-white/5 bg-white/5 px-3 py-2">
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">预警</div>
              <div className={`mt-1 text-base font-black ${(storeStats?.alertCount || 0) > 0 ? 'text-amber-300' : 'text-white'}`}>
                {storeStats?.alertCount ?? 0}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 custom-scrollbar">
        <div className="space-y-5">
          {sections.map((section) => (
            <div key={section.key} className="space-y-2">
              <p className="px-2 text-[10px] uppercase tracking-[0.28em] text-slate-500 font-black">{section.title}</p>
              <div className="space-y-1.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  const badge = getBadge(item);

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(item.id);
                        onCloseMobile?.();
                      }}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition-all duration-200 active:translate-y-px ${
                        isActive
                          ? 'border-emerald-400/30 bg-emerald-500/10 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.12)]'
                          : 'border-transparent bg-transparent hover:border-white/5 hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
                            isActive ? 'bg-emerald-400 text-slate-950' : 'bg-white/5 text-slate-300'
                          }`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`font-bold ${isActive ? 'text-white' : 'text-slate-200'}`}>{item.label}</span>
                              {isActive && (
                                <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-300">
                                  当前
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-xs leading-5 text-slate-400">{item.description}</p>
                          </div>
                        </div>

                        {badge && (
                          <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${
                            item.id === 'inventory'
                              ? 'bg-amber-400/15 text-amber-300'
                              : 'bg-white/8 text-slate-300'
                          }`}>
                            {badge}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 border-t border-white/5">
        <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
          <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500 font-black">当前权限</p>
          <div className="mt-2 flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${canEdit ? 'bg-emerald-400 animate-pulse' : 'bg-amber-300'}`} />
            <span className="text-xs font-medium text-slate-200">{canEdit ? '管理员模式' : '只读查看模式'}</span>
          </div>
          {isMobile && (
            <p className="mt-3 text-[11px] leading-5 text-slate-500">点任一菜单后会自动关闭侧边栏，手机上切页会更顺手。</p>
          )}
        </div>
        <p className="mt-4 text-center text-[10px] font-medium text-slate-600 opacity-60">&copy; 2026 智铺管理系统 v2.5</p>
      </div>
    </>
  );

  return (
    <>
      <div className="hidden md:flex w-72 bg-slate-950 text-white flex-col h-full border-r border-slate-800/50 shadow-2xl">
        {renderNav(false)}
      </div>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-[120] flex">
          <button
            type="button"
            onClick={onCloseMobile}
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-[2px]"
            aria-label="关闭导航"
          />
          <div className="relative w-[88%] max-w-[360px] bg-slate-950 text-white flex flex-col h-full border-r border-slate-800/50 shadow-2xl page-enter">
            {renderNav(true)}
          </div>
        </div>
      )}
    </>
  );
}
