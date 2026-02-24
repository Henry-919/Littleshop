import React, { useEffect, useState } from 'react';
import { Building2, Plus, Trash2, Loader2, Edit2, Check, RotateCcw } from 'lucide-react';
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

  const loadStores = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('stores').select('id, name').order('name');
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
    const { error } = await supabase.from('stores').delete().eq('id', storeItem.id);
    if (!error) {
      await loadStores();
      onStoresChanged?.();
    }
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
      <div className="p-6 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
        <div className="p-3 bg-emerald-100 text-emerald-600 rounded-xl">
          <Building2 className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">门店管理</h2>
          <p className="text-slate-500 mt-1">维护门店信息，支持多门店数据隔离</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/30">
          <form onSubmit={handleAddStore} className="flex gap-3">
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
              className="px-6 py-3 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-xl font-bold transition-all flex items-center gap-2 shadow-sm active:scale-95"
            >
              {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
              添加门店
            </button>
          </form>
        </div>

        <div className="p-0">
          {stores.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
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
                          className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
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
    </div>
  );
}
