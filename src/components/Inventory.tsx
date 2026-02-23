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
  const { updateProduct, deleteProduct, fetchData, loading } = store || {};

  const [isScanOpen, setIsScanOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<any>(null);
  const [editingStock, setEditingStock] = useState<{ [key: string]: number }>({});

  // 搜索过滤
  const filteredProducts = useMemo(() => {
    return products.filter(p => 
      (p.name || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [products, searchTerm]);

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

          <button
            onClick={() => setIsScanOpen(true)}
            className="px-4 py-2 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-xl font-bold transition-all flex items-center gap-2 border border-indigo-100 shadow-sm text-sm"
          >
            <ScanLine className="w-5 h-5" /> AI 小票扫描
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
                <th className="px-6 py-4">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredProducts.map(product => (
                <tr key={product.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    {editingId === product.id ? (
                      <input 
                        className="border rounded px-2 py-1 w-full"
                        value={editFormData.name}
                        onChange={e => setEditFormData({...editFormData, name: e.target.value})}
                      />
                    ) : <span className="font-bold text-slate-700">{product.name}</span>}
                  </td>
                  <td>
                    {editingStock[product.id] !== undefined ? (
                      <input
                        type="number"
                        value={editingStock[product.id]}
                        onChange={(e) => handleStockChange(product.id, parseInt(e.target.value, 10))}
                      />
                    ) : (
                      product.stock
                    )}
                  </td>
                  <td>
                    {editingStock[product.id] !== undefined ? (
                      <button onClick={() => saveStockChange(product.id)}>保存</button>
                    ) : (
                      <button onClick={() => handleStockChange(product.id, product.stock)}>编辑</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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