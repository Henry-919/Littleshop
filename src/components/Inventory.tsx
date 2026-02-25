import React, { useState, useMemo } from 'react';
import { useStore } from '../hooks/useStore';
import { supabase } from '../lib/supabase';
import * as XLSX from 'xlsx';
import { 
  Layers, Search, ScanLine, Plus, Edit2, Trash2, Check, RotateCcw, X, AlertTriangle 
} from 'lucide-react';
import { ExcelImporter } from './ExcelImporter';
import { ReceiptScanner } from './ReceiptScanner';
import { StockBatchImporter } from './StockBatchImporter';

export function Inventory({ store, storeId }: { store: ReturnType<typeof useStore>; storeId?: string }) {
  // 1. 防御性数据获取
  const products = store?.products || [];
  const categories = store?.categories || [];
  const { updateProduct, deleteProduct, fetchData, loading, addProduct } = store || {};

  const [isScanOpen, setIsScanOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<any>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addFormData, setAddFormData] = useState({
    name: '',
    cost_price: '',
    stock: '',
    category_id: ''
  });
  const [inboundStart, setInboundStart] = useState('');
  const [inboundEnd, setInboundEnd] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [dwellFilter, setDwellFilter] = useState<'all' | '0-7' | '8-30' | '30+'>('all');
  const [stockStatusFilter, setStockStatusFilter] = useState<'all' | 'negative'>('all');
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedProducts, setDeletedProducts] = useState<any[]>([]);
  const [deletedLoading, setDeletedLoading] = useState(false);
  const [deletedPage, setDeletedPage] = useState(1);

  const DELETED_PAGE_SIZE = 10;

  const loadDeletedProducts = async () => {
    if (!storeId) return;
    setDeletedLoading(true);
    const { data, error } = await supabase
      .from('products')
      .select('id, name, deleted_at')
      .eq('store_id', storeId)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false });
    if (!error && data) {
      setDeletedProducts(data);
    }
    setDeletedLoading(false);
  };

  const handleClearFilters = () => {
    setInboundStart('');
    setInboundEnd('');
    setCategoryFilter('all');
    setDwellFilter('all');
    setStockStatusFilter('all');
  };

  const handleExportNegativeStock = () => {
    const negativeProducts = products.filter((p: any) => Number(p.stock) < 0);
    if (negativeProducts.length === 0) {
      alert('当前没有负库存商品');
      return;
    }

    const rows = negativeProducts.map((item: any) => ({
      商品名称: item.name,
      分类: getCategoryName(item.category_id),
      当前库存: item.stock,
      成本价: item.cost_price ?? '',
      入库时间: formatInboundDate(item.time),
      滞留时间: formatDwellDays(item.time)
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, '负库存清单');
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    XLSX.writeFile(wb, `负库存清单_${stamp}.xlsx`);
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

  const formatCostPrice = (value?: number) => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
    return Number(value).toFixed(2);
  };

  const getCategoryName = (categoryId?: string) => {
    if (!categoryId) return '未分类';
    return categories.find(c => c.id === categoryId)?.name || '未分类';
  };

  // 搜索过滤
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesSearch = (p.name || '').toLowerCase().includes(searchTerm.toLowerCase());

      const productCategoryId = (p.category_id ?? '').toString().trim();
      const selectedCategory = categoryFilter.toString().trim();
      const matchesCategory = (() => {
        if (selectedCategory === 'all') return true;
        if (selectedCategory === 'uncategorized') return !productCategoryId;
        return productCategoryId === selectedCategory;
      })();

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

      const matchesStockStatus = (() => {
        if (stockStatusFilter === 'all') return true;
        return Number(p.stock) < 0;
      })();

      return matchesSearch && matchesCategory && matchesTime && matchesDwell && matchesStockStatus;
    });
  }, [products, searchTerm, categoryFilter, inboundStart, inboundEnd, dwellFilter, stockStatusFilter]);

  // 行内编辑逻辑
  const startEditing = (p: any) => {
    setEditingId(p.id);
    setEditFormData({ ...p, category_id: p.category_id || '' });
  };

  const handleSaveEdit = async () => {
    if (!editingId || !updateProduct) return;
    const payload = {
      ...editFormData,
      stock: Number.isFinite(Number(editFormData?.stock)) ? Number(editFormData.stock) : 0,
      category_id: editFormData?.category_id || undefined
    };
    const success = await updateProduct(editingId, payload);
    if (success) {
      setEditingId(null);
      setEditFormData(null);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditFormData(null);
  };

  const handleAddProduct = async () => {
    if (!addProduct || !updateProduct) return;
    const name = addFormData.name.trim();
    if (!name) return;
    const normalize = (value: string) => value.trim().toLowerCase();
    const costPrice = Number(addFormData.cost_price) || 0;
    const hasCostPrice = addFormData.cost_price.toString().trim() !== '';
    const stock = Number(addFormData.stock) || 0;
    let category_id = addFormData.category_id || undefined;

    // 未手动选择分类时，自动归入“未分类”
    if (!category_id && storeId) {
      const defaultCategoryName = '未分类';

      const existingCategory = categories.find(c => normalize(c.name) === normalize(defaultCategoryName));
      if (existingCategory) {
        category_id = existingCategory.id;
      } else {
        const { data: newCategory, error: createCategoryError } = await supabase
          .from('categories')
          .insert([{ name: defaultCategoryName, store_id: storeId }])
          .select('id,name')
          .single();

        if (!createCategoryError && newCategory) {
          category_id = newCategory.id;
        } else if ((createCategoryError as any)?.code === '23505' || (createCategoryError as any)?.status === 409) {
          const { data: duplicatedCategory } = await supabase
            .from('categories')
            .select('id,name')
            .eq('store_id', storeId)
            .ilike('name', defaultCategoryName)
            .is('deleted_at', null)
            .limit(1);

          if (duplicatedCategory && duplicatedCategory[0]) {
            category_id = duplicatedCategory[0].id;
          }
        }
      }
    }

    const existingProduct = products.find((p: any) => normalize(p.name || '') === normalize(name));
    if (existingProduct) {
      const updates: any = {
        stock: (Number(existingProduct.stock) || 0) + stock
      };

      if (hasCostPrice) {
        updates.cost_price = costPrice;
        updates.price = costPrice;
      }
      if (category_id) {
        updates.category_id = category_id;
      }

      const ok = await updateProduct(existingProduct.id, updates);
      if (ok) {
        setAddFormData({ name: '', cost_price: '', stock: '', category_id: '' });
        setIsAddOpen(false);
      }
      return;
    }

    const { error } = await addProduct({
      name,
      price: costPrice,
      cost_price: costPrice,
      stock,
      category_id
    });

    if (!error) {
      setAddFormData({ name: '', cost_price: '', stock: '', category_id: '' });
      setIsAddOpen(false);
    }
  };

  const deletedTotalPages = Math.max(1, Math.ceil(deletedProducts.length / DELETED_PAGE_SIZE));
  const safeDeletedPage = Math.min(deletedPage, deletedTotalPages);
  const pagedDeletedProducts = deletedProducts.slice(
    (safeDeletedPage - 1) * DELETED_PAGE_SIZE,
    safeDeletedPage * DELETED_PAGE_SIZE
  );

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
    <div className="space-y-5 animate-in fade-in duration-500">
      {/* 顶部工具栏 */}
      <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-slate-100 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
          <div className="p-3 bg-emerald-500 text-white rounded-2xl shadow-lg shadow-emerald-200">
            <Layers className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">库存中心</h2>
            <p className="text-slate-500 text-sm">当前共管理 {products.length} 项商品</p>
          </div>
        </div>

          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
            <button
              onClick={async () => {
                setDeletedPage(1);
                setShowDeleted(true);
                await loadDeletedProducts();
              }}
              className="w-full sm:w-auto px-3 py-2 bg-slate-900 text-white hover:bg-slate-800 rounded-xl font-bold transition-all flex items-center justify-center gap-2 border border-slate-900 shadow-sm text-sm"
            >
              查看删除记录
            </button>

            <button
              onClick={() => setIsScanOpen(true)}
              className="w-full sm:w-auto px-4 py-2 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-xl font-bold transition-all flex items-center justify-center gap-2 border border-indigo-100 shadow-sm text-sm"
            >
              <ScanLine className="w-5 h-5" /> AI 小票扫描
            </button>

            <button
              onClick={() => setIsAddOpen(true)}
              className="w-full sm:w-auto px-4 py-2 bg-slate-900 text-white hover:bg-slate-800 rounded-xl font-bold transition-all flex items-center justify-center gap-2 border border-slate-900 shadow-sm text-sm"
            >
              <Plus className="w-5 h-5" /> 新增商品
            </button>

            <ExcelImporter store={store} />
            <StockBatchImporter store={store} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[minmax(240px,1.1fr)_minmax(280px,1.15fr)_repeat(3,minmax(140px,1fr))] gap-2 md:gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text"
              placeholder="搜索商品..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-sm transition-all"
            />
          </div>

          <div className="flex items-center gap-2 min-w-0">
            <input
              type="date"
              value={inboundStart}
              onChange={(e) => setInboundStart(e.target.value)}
              className="flex-1 min-w-0 px-3 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <span className="text-xs text-slate-400">-</span>
            <input
              type="date"
              value={inboundEnd}
              onChange={(e) => setInboundEnd(e.target.value)}
              className="flex-1 min-w-0 px-3 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">产品类型：全部</option>
            <option value="uncategorized">产品类型：未分类</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <select
            value={dwellFilter}
            onChange={(e) => setDwellFilter(e.target.value as typeof dwellFilter)}
            className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">滞留天数：全部</option>
            <option value="0-7">0-7 天</option>
            <option value="8-30">8-30 天</option>
            <option value="30+">30 天以上</option>
          </select>

          <button
            onClick={handleClearFilters}
            className="w-full px-3 py-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl font-bold transition-all flex items-center justify-center gap-2 border border-slate-200 shadow-sm text-sm"
          >
            清空筛选
          </button>

          <select
            value={stockStatusFilter}
            onChange={(e) => setStockStatusFilter(e.target.value as 'all' | 'negative')}
            className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">库存状态：全部</option>
            <option value="negative">库存状态：负库存</option>
          </select>

          <button
            onClick={handleExportNegativeStock}
            className="w-full px-3 py-2.5 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-xl font-bold transition-all flex items-center justify-center gap-2 border border-rose-100 shadow-sm text-sm"
          >
            导出负库存
          </button>
        </div>
      </div>

      {/* 移动端卡片 */}
      <div className="md:hidden space-y-3">
        {filteredProducts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center">
            <div className="flex flex-col items-center gap-2 text-slate-400">
              <AlertTriangle className="w-5 h-5" />
              <p className="text-sm">未找到符合条件的商品</p>
              <p className="text-xs text-slate-400">可以调整筛选条件或清空筛选后重试</p>
            </div>
          </div>
        ) : (
          filteredProducts.map(product => (
            <div key={product.id} className={`rounded-2xl p-4 space-y-3 shadow-sm border ${Number(product.stock) < 0 ? 'bg-rose-50/40 border-rose-200' : 'bg-white border-slate-100'}`}>
              <div className="flex items-start justify-between gap-3">
                {editingId === product.id ? (
                  <div className="flex-1 space-y-2">
                    <input
                      className="border border-slate-200 rounded-lg px-2 py-1 w-full text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                      value={editFormData.name}
                      onChange={e => setEditFormData({ ...editFormData, name: e.target.value })}
                    />
                    <select
                      value={editFormData.category_id || ''}
                      onChange={e => setEditFormData({ ...editFormData, category_id: e.target.value })}
                      className="border border-slate-200 rounded-lg px-2 py-1 w-full text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    >
                      <option value="">未分类</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800 truncate">{product.name}</p>
                      <p className="text-xs text-slate-500 mt-1">分类：{getCategoryName(product.category_id)}</p>
                    </div>
                  </>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-slate-50 rounded-lg p-2 text-center">
                  <p className="text-[11px] text-slate-500">库存</p>
                  {editingId === product.id ? (
                    <input
                      type="number"
                      value={editFormData.stock ?? ''}
                      onChange={(e) => setEditFormData({ ...editFormData, stock: e.target.value })}
                      className="mt-1 w-full px-2 py-1 border border-slate-200 rounded-lg text-center font-mono font-bold text-slate-700"
                    />
                  ) : (
                    <p className={`font-mono font-bold mt-1 ${Number(product.stock) < 0 ? 'text-rose-600' : 'text-slate-700'}`}>{product.stock}</p>
                  )}
                </div>
                <div className="bg-slate-50 rounded-lg p-2 text-center">
                  <p className="text-[11px] text-slate-500">成本价</p>
                  <p className="font-mono font-bold text-slate-700 mt-1">{formatCostPrice(product.cost_price)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2 text-center">
                  <p className="text-[11px] text-slate-500">入库时间</p>
                  <p className="text-slate-700 mt-1">{formatInboundDate(product.time)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2 text-center">
                  <p className="text-[11px] text-slate-500">滞留时间</p>
                  <p className="font-mono text-slate-700 mt-1">{formatDwellDays(product.time)}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {editingId === product.id ? (
                  <>
                    <button
                      onClick={handleSaveEdit}
                      className="flex-1 px-3 py-2 bg-emerald-500 text-white rounded-lg font-bold text-xs"
                    >
                      保存
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="flex-1 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg font-bold text-xs"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => startEditing(product)}
                      className="flex-1 px-3 py-2 bg-slate-900 text-white rounded-lg font-bold text-xs"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => {
                        if (!deleteProduct) return;
                        if (window.confirm(`确定要删除商品 "${product.name}" 吗？此操作不可恢复。`)) {
                          deleteProduct(product.id);
                        }
                      }}
                      className="px-3 py-2 text-rose-600 bg-rose-50 rounded-lg"
                      title="删除商品"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 桌面端表格 */}
      <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm table-fixed">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                <th className="px-6 py-4 w-[240px]">商品名称</th>
                <th className="px-6 py-4 w-[160px]">分类</th>
                <th className="px-6 py-4 w-[110px] text-center">库存</th>
                <th className="px-6 py-4 w-[130px] text-center">成本价</th>
                <th className="px-6 py-4 w-[140px] text-center">入库时间</th>
                <th className="px-6 py-4 w-[120px] text-center">滞留时间</th>
                <th className="px-6 py-4 w-[160px] text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredProducts.map(product => (
                <tr key={product.id} className={`transition-colors group ${Number(product.stock) < 0 ? 'bg-rose-50/30 hover:bg-rose-50/60' : 'hover:bg-slate-50/50'}`}>
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
                          title="保存"
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
                      <span className="font-bold text-slate-700 truncate block max-w-[180px]" title={product.name}>{product.name}</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {editingId === product.id ? (
                      <select
                        value={editFormData.category_id || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, category_id: e.target.value })}
                        className="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="">未分类</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-slate-500 whitespace-nowrap truncate block max-w-[120px]" title={getCategoryName(product.category_id)}>
                        {getCategoryName(product.category_id)}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-center">
                    {editingId === product.id ? (
                      <div className="flex justify-center">
                        <input
                          type="number"
                          value={editFormData.stock ?? ''}
                          onChange={(e) => setEditFormData({ ...editFormData, stock: e.target.value })}
                          className="w-24 px-2 py-1 border border-slate-200 rounded-lg text-sm text-center focus:ring-2 focus:ring-emerald-500 outline-none"
                        />
                      </div>
                    ) : (
                      <span className={`font-mono font-bold ${Number(product.stock) < 0 ? 'text-rose-600' : 'text-slate-700'}`}>{product.stock}</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="font-mono font-bold text-slate-700 inline-block">
                      {formatCostPrice(product.cost_price)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="text-slate-500 whitespace-nowrap inline-block">
                      {formatInboundDate(product.time)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="text-slate-500 whitespace-nowrap inline-block">
                      {formatDwellDays(product.time)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    {editingId === product.id ? (
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={handleSaveEdit}
                          className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg font-bold text-xs hover:bg-emerald-600 transition-all border border-emerald-500 shadow-sm"
                        >
                          保存
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg font-bold text-xs hover:bg-slate-200 transition-all border border-slate-200 shadow-sm"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => startEditing(product)}
                          className="px-3 py-1.5 bg-slate-900 text-white rounded-lg font-bold text-xs hover:bg-slate-800 transition-all border border-slate-900 shadow-sm"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => {
                            if (!deleteProduct) return;
                            if (window.confirm(`确定要删除商品 "${product.name}" 吗？此操作不可恢复。`)) {
                              deleteProduct(product.id);
                            }
                          }}
                          className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                          title="删除商品"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}

              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <AlertTriangle className="w-5 h-5" />
                      <p className="text-sm">未找到符合条件的商品</p>
                      <p className="text-xs text-slate-400">可以调整筛选条件或清空筛选后重试</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 新增商品 Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">新增商品</h3>
              <button
                onClick={() => setIsAddOpen(false)}
                className="p-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 md:p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">商品名称</label>
                <input
                  value={addFormData.name}
                  onChange={(e) => setAddFormData({ ...addFormData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  placeholder="例如：A4 复印纸"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">成本价</label>
                  <input
                    type="number"
                    value={addFormData.cost_price}
                    onChange={(e) => setAddFormData({ ...addFormData, cost_price: e.target.value })}
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
            <div className="p-4 md:p-6 pt-0 flex items-center justify-end gap-3">
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
          <div className="bg-slate-50 rounded-3xl md:rounded-[2.5rem] shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden relative flex flex-col border border-white/20">
            <button 
              onClick={() => { setIsScanOpen(false); fetchData?.(); }}
              className="absolute top-4 right-4 md:top-6 md:right-6 p-2 bg-white text-slate-900 rounded-full shadow-lg z-[110] hover:scale-110 transition-transform"
            >
              <X className="w-6 h-6" />
            </button>
            <div className="p-3 md:p-8 overflow-y-auto custom-scrollbar">
               <ReceiptScanner store={store} />
            </div>
          </div>
        </div>
      )}

      {/* 删除记录 Modal */}
      {showDeleted && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden border border-slate-100">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">删除记录 - 商品</h3>
              <button
                onClick={() => setShowDeleted(false)}
                className="p-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6">
              {deletedLoading ? (
                <div className="text-slate-400 text-sm">加载中...</div>
              ) : deletedProducts.length === 0 ? (
                <div className="text-slate-400 text-sm">暂无删除记录</div>
              ) : (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                        <th className="px-6 py-3">商品名称</th>
                        <th className="px-6 py-3">删除时间</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pagedDeletedProducts.map((item) => (
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

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">
                      第 {safeDeletedPage} / {deletedTotalPages} 页 · 共 {deletedProducts.length} 条
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setDeletedPage(prev => Math.max(1, prev - 1))}
                        disabled={safeDeletedPage <= 1}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:text-slate-300 disabled:bg-slate-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-all"
                      >
                        上一页
                      </button>
                      <button
                        onClick={() => setDeletedPage(prev => Math.min(deletedTotalPages, prev + 1))}
                        disabled={safeDeletedPage >= deletedTotalPages}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:text-slate-300 disabled:bg-slate-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-all"
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}