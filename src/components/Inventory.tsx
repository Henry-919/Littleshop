import React, { useState } from 'react';
import { useStore } from '../hooks/useStore';
import { 
  Package, AlertTriangle, Plus, Trash2, X, 
  Edit2, Check, RotateCcw, Search, Tag, Layers, ScanLine 
} from 'lucide-react';
import { ExcelImporter } from './ExcelImporter';
import { ReceiptScanner } from './ReceiptScanner'; 

export function Inventory({ store }: { store: ReturnType<typeof useStore> }) {
  // 1. 防御性结构赋值：如果 store 属性由于加载原因不存在，赋予默认值防止崩溃
  const { 
    products = [], 
    categories = [], 
    addProduct, 
    updateProduct, 
    deleteProduct, 
    fetchData, 
    loading = false 
  } = store;
  
  // 2. 状态管理
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isScanOpen, setIsScanOpen] = useState(false); 
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // 新商品初始状态
  const [newProduct, setNewProduct] = useState({
    name: '',
    price: '',
    cost_price: '',
    stock: '',
    category_id: ''
  });

  // --- 搜索过滤逻辑（增加空值检查） ---
  const filteredProducts = (products || []).filter(p => 
    (p.name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  // --- 行内编辑逻辑 ---
  const startEditing = (product: any) => {
    setEditingId(product.id);
    setEditFormData({ 
      ...product,
      price: (product.price || 0).toString(),
      cost_price: (product.cost_price || 0).toString(),
      stock: (product.stock || 0).toString()
    });
  };

  const handleUpdate = async () => {
    if (!editFormData || !editingId) return;
    const success = await updateProduct(editingId, {
      name: editFormData.name,
      price: parseFloat(editFormData.price) || 0,
      cost_price: parseFloat(editFormData.cost_price) || 0,
      stock: parseInt(editFormData.stock, 10) || 0,
      category_id: editFormData.category_id || undefined
    });
    if (success) setEditingId(null);
  };

  // 3. 加载中状态处理
  if (loading && products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-slate-400">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-emerald-500 border-t-transparent mb-4"></div>
        <p className="font-medium animate-pulse">正在获取云端数据，请稍候...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* 顶部工具栏 */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100 gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-emerald-500 text-white rounded-2xl shadow-lg shadow-emerald-200">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">库存中心</h2>
            <p className="text-slate-500 text-sm">当前共管理 {products.length} 项商品</p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          {/* 搜索框 */}
          <div className="relative group">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
            <input 
              type="text"
              placeholder="搜索商品名称..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 w-full lg:w-48 transition-all text-sm"
            />
          </div>

          {/* AI 扫描按钮 */}
          <button
            onClick={() => setIsScanOpen(true)}
            className="px-4 py-2.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-xl font-bold transition-all flex items-center gap-2 border border-indigo-100 shadow-sm"
          >
            <ScanLine className="w-5 h-5" />
            发票/小票扫描
          </button>

          <ExcelImporter onImportComplete={() => fetchData?.()} />
          
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold transition-all shadow-md flex items-center gap-2"
          >
            <Plus className="w-5 h-5 text-emerald-400" /> 手动录入
          </button>
        </div>
      </div>

      {/* 库存表格 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-[11px] uppercase font-black tracking-widest">
                <th className="px-6 py-5">商品名称</th>
                <th className="px-6 py-5">分类</th>
                <th className="px-6 py-5">销售单价</th>
                <th className="px-6 py-5">进货成本</th>
                <th className="px-6 py-5">当前库存</th>
                <th className="px-6 py-5 text-right">操作管理</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 text-sm">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">未找到符合条件的商品</td>
                </tr>
              ) : filteredProducts.map(product => {
                const isEditing = editingId === product.id;
                const isLowStock = (product.stock || 0) < 5;
                const category = (categories || []).find(c => c.id === (isEditing ? editFormData.category_id : product.category_id));

                return (
                  <tr key={product.id} className={`${isEditing ? 'bg-emerald-50/50' : 'hover:bg-slate-50/30'} transition-all group`}>
                    <td className="px-6 py-4 font-bold text-slate-800">
                      {isEditing ? (
                        <input 
                          autoFocus
                          className="w-full p-2 border-2 border-emerald-500 rounded-lg outline-none bg-white shadow-inner"
                          value={editFormData.name}
                          onChange={e => setEditFormData({...editFormData, name: e.target.value})}
                        />
                      ) : product.name}
                    </td>
                    <td className="px-6 py-4">
                      {isEditing ? (
                        <select
                          className="w-full p-2 border-2 border-emerald-500 rounded-lg bg-white"
                          value={editFormData.category_id || ''}
                          onChange={e => setEditFormData({...editFormData, category_id: e.target.value})}
                        >
                          <option value="">未分类</option>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      ) : (
                        <span className="px-2 py-1 bg-slate-100 rounded-md text-[10px] font-black text-slate-500 uppercase tracking-tighter">
                          {category?.name || '未分类'}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {isEditing ? (
                        <input
                          type="number"
                          className="w-24 p-2 border-2 border-emerald-500 rounded-lg"
                          value={editFormData.price}
                          onChange={e => setEditFormData({...editFormData, price: e.target.value})}
                        />
                      ) : <span className="text-emerald-600 font-black">￥{Number(product.price || 0).toFixed(2)}</span>}
                    </td>
                    <td className="px-6 py-4 text-slate-400">
                      {isEditing ? (
                        <input
                          type="number"
                          className="w-24 p-2 border-2 border-emerald-500 rounded-lg"
                          value={editFormData.cost_price}
                          onChange={e => setEditFormData({...editFormData, cost_price: e.target.value})}
                        />
                      ) : `￥${Number(product.cost_price || 0).toFixed(2)}`}
                    </td>
                    <td className="px-6 py-4">
                      {isEditing ? (
                        <input
                          type="number"
                          className="w-20 p-2 border-2 border-emerald-500 rounded-lg"
                          value={editFormData.stock}
                          onChange={e => setEditFormData({...editFormData, stock: e.target.value})}
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className={`font-black ${isLowStock ? 'text-rose-600' : 'text-slate-700'}`}>{product.stock || 0}</span>
                          {isLowStock && <AlertTriangle className="w-4 h-4 text-rose-500 animate-pulse" />}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-1">
                        {isEditing ? (
                          <>
                            <button onClick={handleUpdate} className="p-2 bg-emerald-500 text-white rounded-lg"><Check className="w-4 h-4"/></button>
                            <button onClick={() => setEditingId(null)} className="p-2 bg-slate-100 text-slate-400 rounded-lg"><RotateCcw className="w-4 h-4"/></button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEditing(product)} className="p-2 text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"><Edit2 className="w-4 h-4" /></button>
                            <button onClick={() => deleteProduct(product.id)} className="p-2 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"><Trash2 className="w-4 h-4" /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* AI 扫描识别全屏弹窗 */}
      {isScanOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[100] p-4">
          <div className="bg-slate-50 rounded-[2.5rem] shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden relative border border-white/20">
            <button 
              onClick={() => { setIsScanOpen(false); fetchData?.(); }}
              className="absolute top-6 right-6 p-2 bg-white/80 hover:bg-white text-slate-900 rounded-full shadow-lg z-[110] transition-all"
            >
              <X className="w-6 h-6" />
            </button>
            <div className="p-8 overflow-y-auto h-full custom-scrollbar">
              <ReceiptScanner store={store} />
            </div>
          </div>
        </div>
      )}

      {/* 手动录入弹窗 (省略具体 form 代码以保持简洁，可沿用之前逻辑) */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-[100] p-4">
          {/* ... Add Product Form ... */}
        </div>
      )}
    </div>
  );
}