import React, { useState } from 'react';
import { useStore } from '../hooks/useStore';
import { Tags, Plus, Trash2, Loader2, AlertCircle } from 'lucide-react';

export function Categories({ store }: { store: ReturnType<typeof useStore> }) {
  const { categories, addCategory, deleteCategory, loading, products } = store;
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newCategoryName.trim();
    if (!name || isSubmitting) return;

    setIsSubmitting(true);
    const success = await addCategory(name);
    if (success) {
      setNewCategoryName('');
    }
    setIsSubmitting(false);
  };

  const handleDelete = async (id: string, name: string) => {
    // 检查该类目下是否有商品
    const productCount = products.filter(p => p.category_id === id).length;
    
    let message = `确定要删除分类 "${name}" 吗？`;
    if (productCount > 0) {
      message = `该分类下还有 ${productCount} 个商品，删除后这些商品将变为“未分类”。确定删除吗？`;
    }

    if (window.confirm(message)) {
      await deleteCategory(id);
    }
  };

  if (loading && categories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
        <p>正在从数据库加载分类...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 头部区域 */}
      <div className="p-6 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
        <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl">
          <Tags className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">类目管理</h2>
          <p className="text-slate-500 mt-1">管理商品的分类，让库存井井有条</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {/* 添加分类表单 */}
        <div className="p-6 border-b border-slate-100 bg-slate-50/30">
          <form onSubmit={handleAdd} className="flex gap-3">
            <div className="relative flex-1">
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="输入新分类名称（如：办公用品、饮品...）"
                className="w-full p-3 pl-4 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
              />
            </div>
            <button
              type="submit"
              disabled={!newCategoryName.trim() || isSubmitting}
              className="px-6 py-3 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-xl font-bold transition-all flex items-center gap-2 shadow-sm active:scale-95"
            >
              {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
              添加分类
            </button>
          </form>
        </div>

        {/* 分类列表 */}
        <div className="p-0">
          {categories.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                    <th className="px-6 py-4 font-semibold">分类名称</th>
                    <th className="px-6 py-4 font-semibold">包含商品数量</th>
                    <th className="px-6 py-4 font-semibold text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {categories.map(category => {
                    const count = products.filter(p => p.category_id === category.id).length;
                    return (
                      <tr key={category.id} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="px-6 py-4">
                          <span className="font-bold text-slate-700">{category.name}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-sm ${count > 0 ? 'text-slate-500' : 'text-slate-300 italic'}`}>
                            {count} 个商品
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => handleDelete(category.id, category.name)}
                            className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                            title="删除分类"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-20 text-center">
              <div className="w-16 h-16 bg-slate-50 text-slate-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <Tags className="w-8 h-8" />
              </div>
              <p className="text-slate-400 font-medium">暂无分类数据</p>
              <p className="text-sm text-slate-300">添加一个分类开始管理您的库存吧</p>
            </div>
          )}
        </div>
      </div>
      
      {/* 底部提示 */}
      <div className="flex items-center gap-2 px-2 text-amber-600 bg-amber-50 p-4 rounded-xl border border-amber-100">
        <AlertCircle className="w-5 h-5 shrink-0" />
        <p className="text-sm">
          <b>提示：</b>当您使用小票 AI 扫描功能时，系统会自动识别并在这里创建缺失的分类。
        </p>
      </div>
    </div>
  );
}