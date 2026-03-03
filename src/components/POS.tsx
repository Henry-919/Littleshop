import React, { useEffect, useState, useMemo } from 'react';
import { useStore } from '../hooks/useStore';
import { ShoppingBag, User, Plus, Search, CheckCircle2, Tag, Package, DollarSign, CalendarDays } from 'lucide-react';
import { formatZhDateTime } from '../lib/date';
import { buildHistoricalPriceMap, getReferencePrice } from '../lib/pricing';
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
  abnormalPriceNote?: string;
};

const POS_ENTRY_RECORDS_KEY = 'pos_entry_records_v1';
const POS_ENTRY_RECORDS_LIMIT = 120;

const normalizeText = (value: string) => String(value || '').trim().toLowerCase();

export function POS({ store }: { store: ReturnType<typeof useStore> }) {
  const { products, categories, sales, addSale } = store;
  
  // 状态管理
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [salesperson, setSalesperson] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [manualPrice, setManualPrice] = useState<string>('');
  const [abnormalPriceNote, setAbnormalPriceNote] = useState('');
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
    const normalized = normalizeText(searchTerm);
    return products.find(p => normalizeText(p.name) === normalized) || 
           products.find(p => p.id === selectedProductId);
  }, [searchTerm, selectedProductId, products]);

  // 判断是否为"全新商品"
  const isNewProduct = searchTerm.length > 0 && !matchedProduct;

  const historicalPriceMap = useMemo(() => buildHistoricalPriceMap(sales), [sales]);

  const hasHistoricalReference = useMemo(() => {
    if (!matchedProduct || isNewProduct) return false;
    return (historicalPriceMap.get(matchedProduct.id) || 0) > 0;
  }, [matchedProduct, isNewProduct, historicalPriceMap]);

  const referencePrice = useMemo(() => {
    if (!matchedProduct || isNewProduct) return 0;
    return getReferencePrice({
      product: matchedProduct,
      historicalPrice: historicalPriceMap.get(matchedProduct.id)
    });
  }, [matchedProduct, isNewProduct, historicalPriceMap]);

  const priceDeviation = useMemo(() => {
    if (!matchedProduct || isNewProduct) return 0;
    const basePrice = referencePrice;
    const salePrice = parseFloat(manualPrice);
    if (!Number.isFinite(basePrice) || basePrice <= 0) return 0;
    if (!Number.isFinite(salePrice) || salePrice <= 0) return 0;
    return Math.abs(salePrice - basePrice) / basePrice;
  }, [matchedProduct, isNewProduct, manualPrice, referencePrice]);

  const needsAbnormalNote = !!matchedProduct && !isNewProduct && hasHistoricalReference && priceDeviation >= 0.3;

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const salespersonName = salesperson.trim();
    const normalizedSearchTerm = searchTerm.trim();

    if (!salespersonName) {
      setFeedback({ type: 'error', text: '请填写销售人员姓名。' });
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setFeedback({ type: 'error', text: '数量必须大于 0。' });
      return;
    }
    if (!manualPrice || parseFloat(manualPrice) <= 0) {
      setFeedback({ type: 'error', text: '请输入有效的销售单价。' });
      return;
    }

    if (needsAbnormalNote && !abnormalPriceNote.trim()) {
      setFeedback({ type: 'error', text: '当前单价偏差较大，请填写异常备注后再提交。' });
      return;
    }

    if (!normalizedSearchTerm) {
      setFeedback({ type: 'error', text: '请填写商品名称。' });
      return;
    }

    setIsSubmitting(true);
    try {
      let finalProductId = matchedProduct?.id;
      const salePrice = parseFloat(manualPrice);

      if (!isNewProduct && matchedProduct) {
        const basePrice = referencePrice;
        if (hasHistoricalReference && basePrice > 0) {
          const deviation = Math.abs(salePrice - basePrice) / basePrice;
          if (deviation >= 0.3) {
            const confirmed = window.confirm(
              `当前销售单价 ￥${salePrice.toFixed(2)} 与参考标价 ￥${basePrice.toFixed(2)} 偏差较大，确认继续吗？`
            );
            if (!confirmed) {
              setIsSubmitting(false);
              return;
            }
          }
        }

        const currentStock = Number(matchedProduct.stock) || 0;
        if (quantity > currentStock) {
          const confirmed = window.confirm(
            `当前库存 ${currentStock}，本次售卖数量 ${quantity}，将形成负库存，确认继续吗？`
          );
          if (!confirmed) {
            setIsSubmitting(false);
            return;
          }
        }
      }

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
          name: normalizedSearchTerm,
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
      const overrideTotal = salePrice > 0 ? Number((salePrice * quantity).toFixed(2)) : undefined;
      const success = await addSale(finalProductId, quantity, salespersonName, saleDate || undefined, overrideTotal);
      
      if (success) {
        const lastOrder = entryRecords.length ? entryRecords[entryRecords.length - 1].inputOrder : 0;
        const record: PosEntryRecord = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          inputOrder: lastOrder + 1,
          createdAt: new Date().toISOString(),
          productName: normalizedSearchTerm,
          quantity,
          saleUnitPrice: salePrice,
          totalAmount: Number((salePrice * quantity).toFixed(2)),
          salesperson: salespersonName,
          saleDate: saleDate || undefined,
          isNewProduct,
          costPrice: isNewProduct ? (parseFloat(costPrice) || 0) : undefined,
          inventoryInput: isNewProduct ? (parseInt(initStock, 10) || 0) : undefined,
          abnormalPriceNote: needsAbnormalNote ? abnormalPriceNote.trim() : undefined,
        };

        const nextRecords = [...entryRecords, record].slice(-POS_ENTRY_RECORDS_LIMIT);
        persistEntryRecords(nextRecords);

        setFeedback({
          type: 'success',
          text: isNewProduct ? `已创建新商品“${normalizedSearchTerm}”并完成售卖。` : '销售记录已成功添加。'
        });
        // 重置表单（不重置销售员）
        setSearchTerm('');
        setSelectedProductId('');
        setQuantity(1);
        setManualPrice('');
        setAbnormalPriceNote('');
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

      <div className="ui-card overflow-hidden">
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
                className="ui-input"
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
                className="ui-input"
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
                const found = products.find(p => normalizeText(p.name) === normalizeText(e.target.value));
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
              className="ui-input"
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
                className="ui-input"
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
                className="ui-input"
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
                    className="ui-input"
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
                    className="ui-input"
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
                  className="ui-select"
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

          {needsAbnormalNote && (
            <div className="p-3 bg-rose-50/60 border border-rose-200 rounded-xl space-y-2">
              <div className="text-xs font-bold text-rose-700">
                当前售价与标价偏差 {(priceDeviation * 100).toFixed(0)}%，请填写备注
              </div>
              <textarea
                value={abnormalPriceNote}
                onChange={(e) => setAbnormalPriceNote(e.target.value)}
                rows={2}
                placeholder="例如：临期清仓、会员折扣、活动价、协商价..."
                className="ui-input !border-rose-200 !text-sm"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !searchTerm}
            className={`ui-btn w-full py-4 text-lg shadow-sm ${
              isSubmitting ? 'bg-slate-200 text-slate-400' : 'ui-btn-primary'
            }`}
          >
            {isSubmitting ? '处理中...' : <><CheckCircle2 className="w-5 h-5" /> 完成并录入结算</>}
          </button>
        </form>
      </div>

      <div className="ui-card overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900">销售录入记录（人工核对）</h3>
            <p className="text-xs text-slate-500 mt-0.5">按输入顺序保留，便于人工复核</p>
          </div>
          <button
            onClick={() => persistEntryRecords([])}
            className="ui-btn-muted !px-3 !py-1.5 !text-xs !rounded-lg"
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
                  {!!item.abnormalPriceNote && (
                    <div className="mt-1 text-[11px] text-rose-700">
                      单价异常备注：{item.abnormalPriceNote}
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
