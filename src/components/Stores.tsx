import React, { useEffect, useState } from 'react';
import { Building2, Plus, Trash2, Loader2, Edit2, Check, RotateCcw, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface StoreItem {
  id: string;
  name: string;
}

export function Stores({ onStoresChanged }: { onStoresChanged?: () => void }) {
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newStoreName, setNewStoreName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedStores, setDeletedStores] = useState<StoreItem[]>([]);
  const [deletedLoading, setDeletedLoading] = useState(false);

  const loadStores = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('stores').select('id, name').is('deleted_at', null).order('name');
    if (!error && data) {
      setStores(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadStores();
  }, []);

  const handleAddStore = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newStoreName.trim();
    if (!name || isSubmitting) return;

    setIsSubmitting(true);
    const { error } = await supabase.from('stores').insert([{ name }]);
    if (!error) {
      setNewStoreName('');
      await loadStores();
      onStoresChanged?.();
    }
    setIsSubmitting(false);
  };

  const handleDeleteStore = async (storeItem: StoreItem) => {
    if (!window.confirm(`确定要删除门店 "${storeItem.name}" 吗？此操作不可恢复。`)) return;
    const { error } = await supabase.from('stores').update({ deleted_at: new Date().toISOString() }).eq('id', storeItem.id);
    if (!error) {
      await loadStores();
      onStoresChanged?.();
    }
  };

  const loadDeletedStores = async () => {
    setDeletedLoading(true);
    const { data, error } = await supabase
      .from('stores')
      .select('id, name, deleted_at')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false });
    if (!error && data) {
      setDeletedStores(data as StoreItem[]);
    }
    setDeletedLoading(false);
  };

  const startEditing = (storeItem: StoreItem) => {
    setEditingId(storeItem.id);
    setEditName(storeItem.name);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditName('');
  };

  const saveEditing = async () => {
    if (!editingId) return;
    const name = editName.trim();
    if (!name) return;

    const { error } = await supabase.from('stores').update({ name }).eq('id', editingId);
    if (!error) {
      await loadStores();
      onStoresChanged?.();
      cancelEditing();
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-4" />
        <p>正在加载门店...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="p-4 md:p-6 bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="p-3 bg-emerald-100 text-emerald-600 rounded-xl">
          <Building2 className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">门店管理</h2>
          <p className="text-slate-500 mt-1">维护门店信息，支持多门店数据隔离</p>
        </div>
        <div className="sm:ml-auto w-full sm:w-auto">
          <button
            onClick={async () => {
              setShowDeleted(true);
              await loadDeletedStores();
            }}
            className="w-full sm:w-auto px-3 py-2 bg-slate-900 text-white hover:bg-slate-800 rounded-xl font-bold transition-all border border-slate-900 shadow-sm text-sm"
          >
            查看删除记录
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/30">
          <form onSubmit={handleAddStore} className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <input
                type="text"
                value={newStoreName}
                onChange={(e) => setNewStoreName(e.target.value)}
                placeholder="输入门店名称（如：中心店、北区店）"
                className="w-full p-3 pl-4 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
              />
            </div>
            <button
              type="submit"
              disabled={!newStoreName.trim() || isSubmitting}
              className="w-full sm:w-auto px-6 py-3 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-sm active:scale-95"
            >
              {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
              添加门店
            </button>
          </form>
        </div>

        <div className="p-0">
          {stores.length > 0 ? (
            <>
              {/* Mobile card view */}
              <div className="sm:hidden divide-y divide-slate-100">
                {stores.map((storeItem) => (
                  <div key={storeItem.id} className="p-4">
                    {editingId === storeItem.id ? (
                      <div className="space-y-2">
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEditing();
                            if (e.key === 'Escape') cancelEditing();
                          }}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={saveEditing}
                            className="flex-1 py-2 bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1"
                          >
                            <Check className="w-3.5 h-3.5" /> 保存
                          </button>
                          <button
                            onClick={cancelEditing}
                            className="flex-1 py-2 bg-white text-slate-600 border border-slate-200 rounded-lg text-xs font-bold flex items-center justify-center gap-1"
                          >
                            <RotateCcw className="w-3.5 h-3.5" /> 取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-700 text-sm">{storeItem.name}</span>
                            <button
                              onClick={() => startEditing(storeItem)}
                              className="p-1.5 text-slate-400 hover:text-sky-500 hover:bg-sky-50 rounded-lg transition-all"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <span className="font-mono text-[10px] text-slate-300 block mt-0.5 truncate">{storeItem.id}</span>
                        </div>
                        <button
                          onClick={() => handleDeleteStore(storeItem)}
                          className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all shrink-0"
                          title="删除门店"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop table view */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full min-w-[760px] text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                      <th className="px-6 py-4 font-semibold">门店名称</th>
                      <th className="px-6 py-4 font-semibold">门店 ID</th>
                      <th className="px-6 py-4 font-semibold text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stores.map((storeItem) => (
                      <tr key={storeItem.id} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="px-6 py-4">
                          {editingId === storeItem.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveEditing();
                                  if (e.key === 'Escape') cancelEditing();
                                }}
                                className="w-full px-2 py-1 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                              />
                              <button
                                onClick={saveEditing}
                                className="p-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-all"
                                title="保存"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={cancelEditing}
                                className="p-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all"
                                title="取消"
                              >
                                <RotateCcw className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-700">{storeItem.name}</span>
                              <button
                                onClick={() => startEditing(storeItem)}
                                className="p-1.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-all"
                                title="编辑门店名称"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className="font-mono text-xs text-slate-400">{storeItem.id}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => handleDeleteStore(storeItem)}
                            className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100"
                            title="删除门店"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="p-20 text-center">
              <div className="w-16 h-16 bg-slate-50 text-slate-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <Building2 className="w-8 h-8" />
              </div>
              <p className="text-slate-400 font-medium">暂无门店数据</p>
              <p className="text-sm text-slate-300">添加一个门店开始管理吧</p>
            </div>
          )}
        </div>
      </div>

      {showDeleted && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[110] flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-3xl max-h-[85vh] sm:max-h-[80vh] overflow-hidden border border-slate-100 flex flex-col">
            <div className="p-4 sm:p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
              <h3 className="text-base sm:text-lg font-bold text-slate-900">删除记录 - 门店</h3>
              <button
                onClick={() => setShowDeleted(false)}
                className="p-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 sm:p-6 overflow-y-auto flex-1">
              {deletedLoading ? (
                <div className="text-slate-400 text-sm">加载中...</div>
              ) : deletedStores.length === 0 ? (
                <div className="text-slate-400 text-sm">暂无删除记录</div>
              ) : (
                <>
                  {/* Mobile cards */}
                  <div className="sm:hidden space-y-2">
                    {deletedStores.map((item: any) => (
                      <div key={item.id} className="bg-slate-50 rounded-xl p-3 flex items-center justify-between">
                        <span className="font-medium text-slate-700 text-sm">{item.name}</span>
                        <span className="text-[11px] text-slate-400">
                          {item.deleted_at ? new Date(item.deleted_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                        </span>
                      </div>
                    ))}
                  </div>
                  {/* Desktop table */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                          <th className="px-6 py-3">门店名称</th>
                          <th className="px-6 py-3">删除时间</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {deletedStores.map((item: any) => (
                          <tr key={item.id}>
                            <td className="px-6 py-3 font-medium text-slate-700">{item.name}</td>
                            <td className="px-6 py-3 text-slate-500">
                              {item.deleted_at ? new Date(item.deleted_at).toLocaleString('zh-CN') : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
