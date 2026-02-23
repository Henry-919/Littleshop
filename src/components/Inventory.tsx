import React, { useState } from 'react';
import { useStore } from '../hooks/useStore';
import { 
  Package, AlertTriangle, Plus, Trash2, X, 
  Edit2, Check, RotateCcw, Search, Tag, DollarSign, Layers 
} from 'lucide-react';
import { ExcelImporter } from './ExcelImporter';

export function Inventory({ store }: { store: ReturnType<typeof useStore> }) {
  const { products, categories, addProduct, updateProduct, deleteProduct, fetchData, loading } = store;
  
  // 模态框与编辑状态
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // 新商品表单状态
  const [newProduct, setNewProduct] = useState({
    name: '',
    price: '',
    cost_price: '',
    stock: '',
    category_id: ''
  });

  // --- 行内编辑逻辑 ---
  const startEditing = (product: any) => {
    setEditingId(product.id);
    setEditFormData({ 
      ...product,
      // 确保数字类型在 input 中正常显示
      price: product.price.toString(),
      cost_price: (product.cost_price || 0).toString(),
      stock: product.stock.toString()
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditFormData(null);
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

    if (success) {
      setEditingId(null);
      setEditFormData(null);
    } else {
      alert('更新失败，请检查网络连接');
    }
  };

  // --- 新增商品逻辑 ---
  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProduct.name || !newProduct.price) return;
    
    const { data } = await addProduct({
      name: newProduct.name,
      price: parseFloat(newProduct.price),
      cost_price: parseFloat(newProduct.cost_price || '0'),
      stock: parseInt(newProduct.stock || '0', 10),
      category_id: newProduct.category_id || undefined
    });
    
    if (data) {
      setIsModalOpen(false);
      setNewProduct({ name: '', price: '', cost_price: '', stock: '', category_id: '' });
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (window.confirm(`确定要删除商品 "${name}" 吗？此操作不可撤销。`)) {
      await deleteProduct(id);
    }
  };

  // 搜索过滤
  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-slate-500">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500 mb-4"></div>
        正在加载库存数据...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 顶部工具栏 */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">库存管理</h2>
          <p className="text-slate-500 mt-1">实时监控库存量并快速编辑商品信息</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          <div className="relative flex-grow lg:flex-grow-0">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text"
              placeholder="搜索商品..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 w-full lg:w-64"
            />
          </div>
          <ExcelImporter onImportComplete={() => fetchData && fetchData()} />
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold transition-all shadow-sm flex items-center gap-2"
          >
            <Plus className="w-5 h-5" /> 新增商品
          </button>
        </div>
      </div>

      {/* 库存表格 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 text-slate-500 text-sm uppercase tracking-wider">
                <th className="px-6 py-4 font-semibold">商品名称</th>
                <th className="px-6 py-4 font-semibold">分类</th>
                <th className="px-6 py-4 font-semibold text-emerald-600">售价</th>
                <th className="px-6 py-4 font-semibold">成本</th>
                <th className="px-6 py-4 font-semibold">库存量</th>
                <th className="px-6 py-4 font-semibold text-right">操作</th>
              </tr>
            </thead>
            <tbody className="text-slate-700 divide-y divide-slate-100">
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic">
                    未找到匹配商品
                  </td>
                </tr>
              )}
              {filteredProducts.map(product => {
                const isEditing = editingId === product.id;
                const isLowStock = product.stock < 5;
                const category = categories?.find(c => c.id === (isEditing ? editFormData.category_id : product.category_id));

                return (
                  <tr key={product.id} className={`${isEditing ? 'bg-emerald-50/40' : 'hover:bg-slate-50/30'} transition-colors`}>
                    {/* 名称 */}
                    <td className="px-6 py-4">
                      {isEditing ? (
                        <input
                          className="w-full p-2 border-2 border-emerald-200 rounded-lg outline-none focus:border-emerald-500"
                          value={editFormData.name}
                          onChange={e => setEditFormData({...editFormData, name: e.target.value})}
                        />
                      ) : <span className="font-semibold text-slate-800">{product.name}</span>}
                    </td>

                    {/* 分类 */}
                    <td className="px-6 py-4">
                      {isEditing ? (
                        <select
                          className="w-full p-2 border-2 border-emerald-200 rounded-lg bg-white outline-none"
                          value={editFormData.category_id || ''}
                          onChange={e => setEditFormData({...editFormData, category_id: e.target.value})}
                        >
                          <option value="">未分类</option>
                          {categories?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      ) : (
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${category ? 'bg-slate-100 text-slate-800' : 'text-slate-400'}`}>
                          {category ? category.name : '无分类'}
                        </span>
                      )}
                    </td>

                    {/* 售价 */}
                    <td className="px-6 py-4">
                      {isEditing ? (
                        <input
                          type="number"
                          className="w-24 p-2 border-2 border-emerald-200 rounded-lg outline-none"
                          value={editFormData.price}
                          onChange={e => setEditFormData({...editFormData, price: e.target.value})}
                        />
                      ) : <span className="text-emerald-600 font-bold">￥{product.price.toFixed(2)}</span>}
                    </td>

                    {/* 成本 */}
                    <td className="px-6 py-4 text-slate-500">
                      {isEditing ? (
                        <input
                          type="number"
                          className="w-24 p-2 border-2 border-emerald-200 rounded-lg outline-none"
                          value={editFormData.cost_price}
                          onChange={e => setEditFormData({...editFormData, cost_price: e.target.value})}
                        />
                      ) : `￥${(product.cost_price || 0).toFixed(2)}`}
                    </td>

                    {/* 库存 */}
                    <td className="px-6 py-4">
                      {isEditing ? (
                        <input
                          type="number"
                          className="w-20 p-2 border-2 border-emerald-200 rounded-lg outline-none"
                          value={editFormData.stock}
                          onChange={e => setEditFormData({...editFormData, stock: e.target.value})}
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className={`text-lg font-bold ${isLowStock ? 'text-rose-600' : 'text-slate-700'}`}>
                            {product.stock}
                          </span>
                          {isLowStock && (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase bg-rose-100 text-rose-600">
                              <AlertTriangle className="w-3 h-3" /> 低库存
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* 操作按钮 */}
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-1">
                        {isEditing ? (
                          <>
                            <button onClick={handleUpdate} className="p-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 shadow-sm" title="保存修改">
                              <Check className="w-5 h-5" />
                            </button>
                            <button onClick={cancelEditing} className="p-2 bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300" title="取消">
                              <RotateCcw className="w-5 h-5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEditing(product)} className="p-2 text-slate-400 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-all">
                              <Edit2 className="w-5 h-5" />
                            </button>
                            <button onClick={() => handleDelete(product.id, product.name)} className="p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 rounded-lg transition-all">
                              <Trash2 className="w-5 h-5" />
                            </button>
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

      {/* 新增商品模态框 */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Plus className="w-6 h-6 text-emerald-500" />
                新增库存商品
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-full transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={handleAddProduct} className="p-6 space-y-5">
              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">商品名称</label>
                <input
                  type="text" required
                  value={newProduct.name}
                  onChange={e => setNewProduct({...newProduct, name: e.target.value})}
                  className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                  placeholder="例如：可口可乐 500ml"
                />
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">所属分类</label>
                <select
                  value={newProduct.category_id}
                  onChange={e => setNewProduct({...newProduct, category_id: e.target.value})}
                  className="w-full p-3 border border-slate-200 rounded-xl outline-none bg-white"
                >
                  <option value="">-- 未选择分类 --</option>
                  {categories?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-semibold text-slate-700 mb-2 block">销售价 (￥)</label>
                  <input
                    type="number" step="0.01" required
                    value={newProduct.price}
                    onChange={e => setNewProduct({...newProduct, price: e.target.value})}
                    className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-700 mb-2 block">成本价 (￥)</label>
                  <input
                    type="number" step="0.01"
                    value={newProduct.cost_price}
                    onChange={e => setNewProduct({...newProduct, cost_price: e.target.value})}
                    className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-700 mb-2 block">初始库存</label>
                <input
                  type="number" required
                  value={newProduct.stock}
                  onChange={e => setNewProduct({...newProduct, stock: e.target.value})}
                  className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                  placeholder="0"
                />
              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-bold text-lg transition-all shadow-lg active:scale-[0.98]"
                >
                  确认保存商品
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}