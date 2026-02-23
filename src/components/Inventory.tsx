import React, { useState, useMemo } from 'react';
import { useStore } from '../hooks/useStore';
import { 
  Package, AlertTriangle, Plus, Trash2, X, 
  Edit2, Check, RotateCcw, Search, Tag, Layers, ScanLine 
} from 'lucide-react';

// 尝试导入，如果你的文件名或路径不同，请在这里修改
import { ExcelImporter } from './ExcelImporter';
import { ReceiptScanner } from './ReceiptScanner';

export function Inventory({ store }: { store: any }) {
  // --- 1. 深度防御性解构 ---
  // 确保即使 store 为空，组件也不会在第一行就崩掉
  const products = store?.products || [];
  const categories = store?.categories || [];
  const loading = store?.loading || false;
  const { addProduct, updateProduct, deleteProduct, fetchData } = store || {};

  // --- 2. 状态初始化 ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isScanOpen, setIsScanOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // --- 3. 计算过滤后的产品 (使用 useMemo 提高稳定性) ---
  const filteredProducts = useMemo(() => {
    if (!Array.isArray(products)) return [];
    return products.filter(p => 
      (p?.name || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [products, searchTerm]);

  // --- 4. 逻辑处理函数 ---
  const startEditing = (product: any) => {
    if (!product) return;
    setEditingId(product.id);
    setEditFormData({ 
      ...product,
      price: (product.price ?? 0).toString(),
      cost_price: (product.cost_price ?? 0).toString(),
      stock: (product.stock ?? 0).toString()
    });
  };

  const handleUpdate = async () => {
    if (!editFormData || !editingId || !updateProduct) return;
    try {
      const success = await updateProduct(editingId, {
        name: editFormData.name,
        price: parseFloat(editFormData.price) || 0,
        cost_price: parseFloat(editFormData.cost_price) || 0,
        stock: parseInt(editFormData.stock, 10) || 0,
        category_id: editFormData.category_id || undefined
      });
      if (success) setEditingId(null);
    } catch (e) {
      console.error("Update failed", e);
    }
  };

  // --- 5. 渲染防护：如果核心数据正在加载且没有任何数据，显示加载占位符 ---
  if (loading && products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-400">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500 mb-4"></div>
        <p>初始化库存系统...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 顶部导航工具栏 */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100 gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500 rounded-lg text-white">
            <Layers size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">库存管理</h2>
            <p className="text-xs text-slate-500">管理商品档案、售价及库存警戒线</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          <div className="relative flex-1 lg:flex-none">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input 
              className="pl-9 pr-4 py-2 bg-slate-50 border-none rounded-xl text-sm w-full lg:w-48 focus:ring-2 focus:ring-emerald-500"
              placeholder="搜索商品..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* 发票扫描入口 */}
          <button 
            onClick={() => setIsScanOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-sm font-bold hover:bg-indigo-100 transition-colors"
          >
            <ScanLine size={18} />
            AI 扫描
          </button>

          {/* 只有在组件存在时才渲染，防止因文件缺失导致白屏 */}
          {typeof ExcelImporter !== 'undefined' && (
            <ExcelImporter onImportComplete={() => fetchData?.()} />
          )}

          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-colors"
          >
            <Plus size={18} />
            新增
          </button>
        </div>
      </div>

      {/* 表格主体 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/50 text-slate-500 font-medium">
              <tr>
                <th className="px-6 py-4">商品信息</th>
                <th className="px-6 py-4">分类</th>
                <th className="px-6 py-4">售价</th>
                <th className="px-6 py-4">库存</th>
                <th className="px-6 py-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredProducts.map((p: any) => {
                const isEditing = editingId === p.id;
                const isLowStock = (p.stock || 0) < 5;
                return (
                  <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      {isEditing ? (
                        <input 
                          className="w-full p-1 border rounded" 
                          value={editFormData.name} 
                          onChange={e => setEditFormData({...editFormData, name: e.target.value})}
                        />
                      ) : (
                        <span className="font-semibold text-slate-700">{p.name}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      {categories.find((c: any) => c.id === (isEditing ? editFormData.category_id : p.category_id))?.name || '未分类'}
                    </td>
                    <td className="px-6 py-4 font-mono text-emerald-600">
                      ￥{Number(p.price || 0).toFixed(2)}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-md font-bold ${isLowStock ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                        {p.stock || 0}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {isEditing ? (
                          <button onClick={handleUpdate} className="text-emerald-600"><Check size={18}/></button>
                        ) : (
                          <button onClick={() => startEditing(p)} className="text-slate-400 hover:text-blue-600"><Edit2 size={16}/></button>
                        )}
                        <button onClick={() => deleteProduct?.(p.id)} className="text-slate-400 hover:text-rose-600"><Trash2 size={16}/></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 扫描 Modal */}
      {isScanOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-5xl max-h-[90vh] overflow-y-auto relative shadow-2xl">
            <button 
              onClick={() => { setIsScanOpen(false); fetchData?.(); }}
              className="absolute top-4 right-4 p-2 hover:bg-slate-100 rounded-full"
            >
              <X size={24} />
            </button>
            <div className="p-6">
              {typeof ReceiptScanner !== 'undefined' ? (
                <ReceiptScanner store={store} />
              ) : (
                <div className="p-20 text-center text-slate-400">Scanner 组件加载失败，请检查文件路径。</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}