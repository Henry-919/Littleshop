import React, { useState, useMemo } from 'react';
import { useStore } from '../hooks/useStore';
import { 
  Layers, Search, ScanLine, Plus, Edit2, Trash2, Check, RotateCcw, X, AlertTriangle 
} from 'lucide-react';
import { ExcelImporter } from './ExcelImporter';
import { ReceiptScanner } from './ReceiptScanner';

export function Inventory({ store }: { store: ReturnType<typeof useStore> }) {
  // 1. 防御性数据获取
  const products = store?.products || [];
  const categories = store?.categories || [];
  const { updateProduct, deleteProduct, fetchData, loading, addProduct } = store || {};

  const [isScanOpen, setIsScanOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<any>(null);
  const [editingStock, setEditingStock] = useState<{ [key: string]: number }>({});
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addFormData, setAddFormData] = useState({
    name: '',
    price: '',
    stock: '',
    category_id: ''
  });
  const [inboundStart, setInboundStart] = useState('');
  const [inboundEnd, setInboundEnd] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [dwellFilter, setDwellFilter] = useState<'all' | '0-7' | '8-30' | '30+'>('all');

  const handleClearFilters = () => {
    setInboundStart('');
    setInboundEnd('');
    setCategoryFilter('all');
    setDwellFilter('all');
  };

  const isTimeOnly = (value: string) => /^\d{2}:\d{2}(:\d{2})?$/.test(value);

  const getInboundDate = (value?: string) => {
    if (!value || isTimeOnly(value)) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  };

  const getDwellDays = (value?: string) => {
    const date = getInboundDate(value);
    if (!date) return null;
    const diffMs = Date.now() - date.getTime();
    if (diffMs <= 0) return 0;
    return Math.floor(diffMs / (24 * 60 * 60 * 1000));
  };

  const formatInboundDate = (value?: string) => {
    const date = getInboundDate(value);
    if (!date) return '-';
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  const formatDwellDays = (value?: string) => {
    const days = getDwellDays(value);
    if (days === null) return '-';
    return `${days}天`;
  };

  // 搜索过滤
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesSearch = (p.name || '').toLowerCase().includes(searchTerm.toLowerCase());

      const matchesCategory = categoryFilter === 'all' || p.category_id === categoryFilter;

      const inboundDate = getInboundDate(p.time);
      const dwellDays = getDwellDays(p.time);

      const matchesTime = (() => {
        if (!inboundStart && !inboundEnd) return true;
        if (!inboundDate) return false;
        const start = inboundStart ? new Date(`${inboundStart}T00:00:00`) : null;
        const end = inboundEnd ? new Date(`${inboundEnd}T23:59:59`) : null;
        if (start && inboundDate < start) return false;
        if (end && inboundDate > end) return false;
        return true;
      })();

      const matchesDwell = (() => {
        if (dwellFilter === 'all') return true;
        if (dwellDays === null) return false;
        if (dwellFilter === '0-7') return dwellDays <= 7;
        if (dwellFilter === '8-30') return dwellDays >= 8 && dwellDays <= 30;
        return dwellDays > 30;
      })();

      return matchesSearch && matchesCategory && matchesTime && matchesDwell;
    });
  }, [products, searchTerm, categoryFilter, inboundStart, inboundEnd, dwellFilter]);

  // 行内编辑逻辑
  const startEditing = (p: any) => {
    setEditingId(p.id);
    setEditFormData({ ...p });
  };

  const handleSaveEdit = async () => {
    if (!editingId || !updateProduct) return;
    const success = await updateProduct(editingId, editFormData);
    if (success) setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditFormData(null);
  };

  const handleAddProduct = async () => {
    if (!addProduct) return;
    const name = addFormData.name.trim();
    if (!name) return;
    const price = Number(addFormData.price) || 0;
    const stock = Number(addFormData.stock) || 0;
    const category_id = addFormData.category_id || undefined;

    const { error } = await addProduct({
      name,
      price,
      stock,
      category_id
    });

    if (!error) {
      setAddFormData({ name: '', price: '', stock: '', category_id: '' });
      setIsAddOpen(false);
    }
  };

  const handleStockChange = (id: string, value: number) => {
    setEditingStock(prev => ({ ...prev, [id]: value }));
  };

  const saveStockChange = async (id: string) => {
    const newStock = editingStock[id];
    if (newStock !== undefined) {
      await updateProduct(id, { stock: newStock });
      setEditingStock(prev => {
        const { [id]: _, ...rest } = prev;
        return rest;
      });
    }
  };

  // 如果正在加载且没数据，显示占位符防止白屏
  if (loading && products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-slate-400">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-emerald-500 border-t-transparent mb-4"></div>
        <p>正在同步云端库存...</p>
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
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text"
              placeholder="搜索商品..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 w-full lg:w-48 text-sm transition-all"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">入库时间</span>
            <input
              type="date"
              value={inboundStart}
              onChange={(e) => setInboundStart(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <span className="text-xs text-slate-400">-</span>
            <input
              type="date"
              value={inboundEnd}
              onChange={(e) => setInboundEnd(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">产品类型：全部</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <select
            value={dwellFilter}
            onChange={(e) => setDwellFilter(e.target.value as typeof dwellFilter)}
            className="px-3 py-2 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">滞留天数：全部</option>
            <option value="0-7">0-7 天</option>
            <option value="8-30">8-30 天</option>
            <option value="30+">30 天以上</option>
          </select>

          <button
            onClick={handleClearFilters}
            className="px-3 py-2 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl font-bold transition-all flex items-center gap-2 border border-slate-200 shadow-sm text-sm"
          >
            清空筛选
          </button>

          <button
            onClick={() => setIsScanOpen(true)}
            className="px-4 py-2 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-xl font-bold transition-all flex items-center gap-2 border border-indigo-100 shadow-sm text-sm"
          >
            <ScanLine className="w-5 h-5" /> AI 小票扫描
          </button>

          <button
            onClick={() => setIsAddOpen(true)}
            className="px-4 py-2 bg-slate-900 text-white hover:bg-slate-800 rounded-xl font-bold transition-all flex items-center gap-2 border border-slate-900 shadow-sm text-sm"
          >
            <Plus className="w-5 h-5" /> 新增商品
          </button>

          <ExcelImporter store={store} />
        </div>
      </div>

      {/* 库存表格 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                <th className="px-6 py-4">商品名称</th>
                <th className="px-6 py-4">库存</th>
                <th className="px-6 py-4">入库时间</th>
                <th className="px-6 py-4">滞留时间</th>
                <th className="px-6 py-4">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredProducts.map(product => (
                <tr key={product.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    {editingId === product.id ? (
                      <div className="flex items-center gap-2">
                        <input 
                          className="border border-slate-200 rounded-lg px-2 py-1 w-full text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                          value={editFormData.name}
                          onChange={e => setEditFormData({ ...editFormData, name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit();
                            if (e.key === 'Escape') handleCancelEdit();
                          }}
                        />
                        <button
                          onClick={handleSaveEdit}
                          className="p-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-all"
                          title="保存名称"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="p-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all"
                          title="取消"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-700">{product.name}</span>
                        <button
                          onClick={() => startEditing(product)}
                          className="p-1.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-all"
                          title="编辑名称"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </td>
                  <td>
                    {editingStock[product.id] !== undefined ? (
                      <input
                        type="number"
                        value={editingStock[product.id]}
                        onChange={(e) => handleStockChange(product.id, parseInt(e.target.value, 10))}
                        className="w-24 px-2 py-1 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                      />
                    ) : (
                      <span className="font-mono font-bold text-slate-700">{product.stock}</span>
                    )}
                  </td>
                  <td>
                    <span className="text-slate-500 whitespace-nowrap">
                      {formatInboundDate(product.time)}
                    </span>
                  </td>
                  <td>
                    <span className="text-slate-500 whitespace-nowrap">
                      {formatDwellDays(product.time)}
                    </span>
                  </td>
                  <td>
                    {editingStock[product.id] !== undefined ? (
                      <button
                        onClick={() => saveStockChange(product.id)}
                        className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg font-bold text-xs hover:bg-emerald-600 transition-all border border-emerald-500 shadow-sm"
                      >
                        保存
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStockChange(product.id, product.stock)}
                        className="px-3 py-1.5 bg-slate-900 text-white rounded-lg font-bold text-xs hover:bg-slate-800 transition-all border border-slate-900 shadow-sm"
                      >
                        编辑
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 新增商品 Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">新增商品</h3>
              <button
                onClick={() => setIsAddOpen(false)}
                className="p-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">商品名称</label>
                <input
                  value={addFormData.name}
                  onChange={(e) => setAddFormData({ ...addFormData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  placeholder="例如：A4 复印纸"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">销售价</label>
                  <input
                    type="number"
                    value={addFormData.price}
                    onChange={(e) => setAddFormData({ ...addFormData, price: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">库存数量</label>
                  <input
                    type="number"
                    value={addFormData.stock}
                    onChange={(e) => setAddFormData({ ...addFormData, stock: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="0"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">商品分类</label>
                <select
                  value={addFormData.category_id}
                  onChange={(e) => setAddFormData({ ...addFormData, category_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="">未分类</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="p-6 pt-0 flex items-center justify-end gap-3">
              <button
                onClick={() => setIsAddOpen(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-200 transition-all"
              >
                取消
              </button>
              <button
                onClick={handleAddProduct}
                className="px-4 py-2 bg-emerald-500 text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition-all"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI 扫描 Modal */}
      {isScanOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-slate-50 rounded-[2.5rem] shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden relative flex flex-col border border-white/20">
            <button 
              onClick={() => { setIsScanOpen(false); fetchData?.(); }}
              className="absolute top-6 right-6 p-2 bg-white text-slate-900 rounded-full shadow-lg z-[110] hover:scale-110 transition-transform"
            >
              <X className="w-6 h-6" />
            </button>
            <div className="p-8 overflow-y-auto custom-scrollbar">
               <ReceiptScanner store={store} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}