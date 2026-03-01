import React, { useEffect, useState, useMemo } from 'react';
import { useStore } from '../hooks/useStore';
import { ShoppingBag, User, Plus, Search, CheckCircle2, Tag, Package, DollarSign, CalendarDays } from 'lucide-react';
import { formatZhDateTime } from '../lib/date';
import { FeedbackToast, type FeedbackMessage } from './common/FeedbackToast';

type PosEntryRecord = {
  id: string;
  inputOrder: number;
  createdAt: string;
  productName: string;
  quantity: number;
  saleUnitPrice: number;
  totalAmount: number;
  salesperson: string;
  saleDate?: string;
  isNewProduct: boolean;
  costPrice?: number;
  inventoryInput?: number;
};

const POS_ENTRY_RECORDS_KEY = 'pos_entry_records_v1';
const POS_ENTRY_RECORDS_LIMIT = 120;

export function POS({ store }: { store: ReturnType<typeof useStore> }) {
  const { products, categories, addSale } = store;
  
  // 状态管理
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [salesperson, setSalesperson] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [manualPrice, setManualPrice] = useState<string>('');
  const [costPrice, setCostPrice] = useState<string>('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [initStock, setInitStock] = useState<string>('');
  const [saleDate, setSaleDate] = useState<string>('');
  const [entryRecords, setEntryRecords] = useState<PosEntryRecord[]>([]);
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(POS_ENTRY_RECORDS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setEntryRecords(parsed.slice(-POS_ENTRY_RECORDS_LIMIT));
      }
    } catch {
      setEntryRecords([]);
    }
  }, []);

  const persistEntryRecords = (next: PosEntryRecord[]) => {
    setEntryRecords(next);
    try {
      localStorage.setItem(POS_ENTRY_RECORDS_KEY, JSON.stringify(next));
    } catch {
      // ignore write failure
    }
  };

  // 1. 自动匹配：根据输入内容筛选已有商品
  const matchedProduct = useMemo(() => {
    return products.find(p => p.name.toLowerCase() === searchTerm.toLowerCase()) || 
           products.find(p => p.id === selectedProductId);
  }, [searchTerm, selectedProductId, products]);

  // 判断是否为"全新商品"
  const isNewProduct = searchTerm.length > 0 && !matchedProduct;

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!salesperson) {
      setFeedback({ type: 'error', text: '请填写销售人员姓名。' });
      return;
    }
    if (quantity <= 0) {
      setFeedback({ type: 'error', text: '数量必须大于 0。' });
      return;
    }
    if (!manualPrice || parseFloat(manualPrice) <= 0) {
      setFeedback({ type: 'error', text: '请输入有效的销售单价。' });
      return;
    }

    setIsSubmitting(true);
    try {
      let finalProductId = matchedProduct?.id;
      const salePrice = parseFloat(manualPrice);

      // 🚀 核心逻辑：如果是新商品，先执行创建
      if (isNewProduct) {
        const newCostPrice = parseFloat(costPrice) || 0;
        const newInitStock = parseInt(initStock, 10) || 0;

        if (newCostPrice <= 0) {
          setFeedback({ type: 'error', text: '新商品请填写有效的成本价。' });
          setIsSubmitting(false);
          return;
        }

        // 先把新商品插入数据库，库存设为初始库存数
        const { data: newProd, error } = await store.addProduct({
          name: searchTerm,
          price: salePrice,
          stock: newInitStock,
          category_id: selectedCategoryId || undefined,
          cost_price: newCostPrice
        });

        if (newProd) {
          finalProductId = newProd.id;
        } else {
          throw new Error("创建新商品失败");
        }
      }

      if (!finalProductId) throw new Error("无法获取商品ID");

      // 执行售卖记录录入，使用手动输入的单价计算总金额
      const overrideTotal = salePrice > 0 ? salePrice * quantity : undefined;
      const success = await addSale(finalProductId, quantity, salesperson, saleDate || undefined, overrideTotal);
      
      if (success) {
        const lastOrder = entryRecords.length ? entryRecords[entryRecords.length - 1].inputOrder : 0;
        const record: PosEntryRecord = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          inputOrder: lastOrder + 1,
          createdAt: new Date().toISOString(),
          productName: searchTerm,
          quantity,
          saleUnitPrice: salePrice,
          totalAmount: Number((salePrice * quantity).toFixed(2)),
          salesperson,
          saleDate: saleDate || undefined,
          isNewProduct,
          costPrice: isNewProduct ? (parseFloat(costPrice) || 0) : undefined,
          inventoryInput: isNewProduct ? (parseInt(initStock, 10) || 0) : undefined,
        };

        const nextRecords = [...entryRecords, record].slice(-POS_ENTRY_RECORDS_LIMIT);
        persistEntryRecords(nextRecords);

        setFeedback({
          type: 'success',
          text: isNewProduct ? `已创建新商品“${searchTerm}”并完成售卖。` : '销售记录已成功添加。'
        });
        // 重置表单（不重置销售员）
        setSearchTerm('');
        setSelectedProductId('');
        setQuantity(1);
        setManualPrice('');
        setCostPrice('');
        setInitStock('');
        setSelectedCategoryId('');
      } else {
        setFeedback({ type: 'error', text: '销售失败，请稍后重试。' });
      }
    } catch (error) {
      console.error("Checkout error:", error);
      setFeedback({ type: 'error', text: '提交过程中发生错误，请重试。' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <FeedbackToast message={feedback} onClose={() => setFeedback(null)} />

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ShoppingBag className="w-6 h-6 text-emerald-500" />
            快速售卖 & 录入
          </h2>
          <p className="text-slate-500 mt-1">输入名称可直接选择或创建新商品</p>
        </div>

        <form onSubmit={handleCheckout} className="p-6 space-y-5">
          {/* 销售人员 + 日期（置顶，结算后不清空） */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                <User className="w-4 h-4" /> 销售人员
              </label>
              <input
                type="text"
                value={salesperson}
                onChange={(e) => setSalesperson(e.target.value)}
                placeholder="输入经手人姓名（结算后保留）"
                className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                <CalendarDays className="w-4 h-4" /> 销售日期
              </label>
              <input
                type="date"
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
                className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                title="不填则默认当天"
              />
            </div>
          </div>

          {/* 商品名称输入/搜索 */}
          <div className="relative">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
              <Search className="w-4 h-4" /> 商品名称
            </label>
            <input
              type="text"
              list="product-list"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                const found = products.find(p => p.name === e.target.value);
                if (found) {
                  setSelectedProductId(found.id);
                  setManualPrice('');
                  setCostPrice(String(found.cost_price ?? found.price ?? 0));
                } else {
                  setSelectedProductId('');
                  setManualPrice('');
                  setCostPrice('');
                }
              }}
              placeholder="输入名称搜索或直接输入新商品名..."
              className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
              required
            />
            <datalist id="product-list">
              {products.map(p => <option key={p.id} value={p.name} />)}
            </datalist>
            
            {isNewProduct && (
              <div className="mt-2 text-xs bg-amber-50 text-amber-600 p-2 rounded-lg border border-amber-100 flex items-center gap-2">
                <Plus className="w-3 h-3" /> 检测到新商品，结算时将自动创建到库存。
              </div>
            )}
          </div>

          {/* 已有商品：成本价 & 库存信息展示 */}
          {matchedProduct && (
            <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-sm">
              <Package className="w-4 h-4 text-emerald-600 shrink-0" />
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-emerald-800">
                <span>成本价：<strong>￥{matchedProduct.cost_price ?? matchedProduct.price ?? '-'}</strong></span>
                <span>当前库存：<strong>{matchedProduct.stock}</strong></span>
              </div>
            </div>
          )}

          {/* 销售价 + 数量 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                <DollarSign className="w-4 h-4" /> 销售单价 (￥)
              </label>
              <input
                type="number"
                step="0.01"
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
                className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                placeholder="手动输入销售价"
                required
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-slate-700 mb-2 block">售卖数量</label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                required
              />
            </div>
          </div>

          {/* 新商品额外字段：成本价 + 初始库存 + 分类 */}
          {isNewProduct && (
            <div className="space-y-4 p-4 bg-amber-50/50 border border-amber-100 rounded-xl">
              <div className="text-xs font-bold text-amber-700 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> 新商品入库信息
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-semibold text-slate-700 mb-2 block">成本价 (￥)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-400 outline-none bg-white"
                    placeholder="必填"
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-700 mb-2 block">初始库存数量</label>
                  <input
                    type="number"
                    min="0"
                    value={initStock}
                    onChange={(e) => setInitStock(e.target.value)}
                    className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-400 outline-none bg-white"
                    placeholder="默认 0"
                  />
                </div>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                  <Tag className="w-4 h-4" /> 分类 (可选)
                </label>
                <select
                  value={selectedCategoryId}
                  onChange={(e) => setSelectedCategoryId(e.target.value)}
                  className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                >
                  <option value="">-- 未分类 --</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* 小计预览 */}
          {manualPrice && quantity > 0 && (
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl text-sm border border-slate-100">
              <span className="text-slate-600">小计</span>
              <span className="text-lg font-bold text-slate-900">￥{(parseFloat(manualPrice) * quantity).toFixed(2)}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !searchTerm}
            className={`w-full py-4 rounded-xl font-bold text-lg transition-all shadow-md flex items-center justify-center gap-2 ${
              isSubmitting ? 'bg-slate-200 text-slate-400' : 'bg-emerald-500 hover:bg-emerald-600 text-white'
            }`}
          >
            {isSubmitting ? '处理中...' : <><CheckCircle2 className="w-5 h-5" /> 完成并录入结算</>}
          </button>
        </form>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900">销售录入记录（人工核对）</h3>
            <p className="text-xs text-slate-500 mt-0.5">按输入顺序保留，便于人工复核</p>
          </div>
          <button
            onClick={() => persistEntryRecords([])}
            className="px-3 py-1.5 text-xs font-bold bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-all"
          >
            清空
          </button>
        </div>

        <div className="p-4 sm:p-5">
          {entryRecords.length === 0 ? (
            <div className="text-sm text-slate-400">暂无销售录入记录</div>
          ) : (
            <div className="max-h-[42vh] overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-100">
              {entryRecords.map((item) => (
                <div key={item.id} className="p-3 text-xs sm:text-sm bg-white">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-slate-800 break-words">#{item.inputOrder} · {item.productName}</div>
                    <div className="text-[11px] text-slate-400 shrink-0">{formatZhDateTime(item.createdAt)}</div>
                  </div>
                  <div className="mt-1 text-slate-600 break-words">
                    数量 {item.quantity} · 单价 ￥{item.saleUnitPrice.toFixed(2)} · 小计 ￥{item.totalAmount.toFixed(2)}
                  </div>
                  <div className="mt-1 text-slate-500 break-words">
                    销售员：{item.salesperson || '系统默认'} · 销售日期：{item.saleDate || '未指定'} · {item.isNewProduct ? '新商品' : '已有商品'}
                  </div>
                  {item.isNewProduct && (
                    <div className="mt-1 text-[11px] text-amber-700">
                      新商品入库：成本价 ￥{Number(item.costPrice || 0).toFixed(2)} · 初始库存 {item.inventoryInput ?? 0}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
