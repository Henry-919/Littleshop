import React, { useState } from 'react';
import { useStore } from '../hooks/useStore';
import { Tags, Plus, Trash2 } from 'lucide-react';

export function Categories({ store }: { store: ReturnType<typeof useStore> }) {
  const { categories, addCategory, deleteCategory } = store;
  const [newCategoryName, setNewCategoryName] = useState('');

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    const success = await addCategory(newCategoryName.trim());
    if (success) {
      setNewCategoryName('');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to delete the category "${name}"?`)) {
      await deleteCategory(id);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="p-6 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center gap-3">
        <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl">
          <Tags className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Category Management</h2>
          <p className="text-slate-500 mt-1">Organize your products into categories</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <form onSubmit={handleAdd} className="flex gap-3">
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="Enter new category name..."
              className="flex-1 p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
            />
            <button
              type="submit"
              disabled={!newCategoryName.trim()}
              className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white rounded-xl font-bold transition-colors flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Add Category
            </button>
          </form>
        </div>

        <div className="p-0">
          {categories.length > 0 ? (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                  <th className="px-6 py-4 font-medium">Category Name</th>
                  <th className="px-6 py-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categories.map(category => (
                  <tr key={category.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-slate-900">
                      {category.name}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleDelete(category.id, category.name)}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors inline-flex items-center justify-center"
                        title="Delete Category"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-10 text-center text-slate-500">
              <Tags className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>No categories found. Add one above.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
