import React, { useState, useMemo } from 'react';
import { useStore } from '../hooks/useStore';
import { ShoppingBag, User, Plus, Search, CheckCircle2, Tag, Package, DollarSign } from 'lucide-react';

export function POS({ store }: { store: ReturnType<typeof useStore> }) {
  const { products, categories, addSale, addProduct } = store;
  
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

  // 1. 自动匹配：根据输入内容筛选已有商品
  const matchedProduct = useMemo(() => {
    return products.find(p => p.name.toLowerCase() === searchTerm.toLowerCase()) || 
           products.find(p => p.id === selectedProductId);
  }, [searchTerm, selectedProductId, products]);

  // 判断是否为"全新商品"
  const isNewProduct = searchTerm.length > 0 && !matchedProduct;

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!salesperson) return alert('请填写销售人员姓名');
    if (quantity <= 0) return alert('数量必须大于0');
    if (!manualPrice || parseFloat(manualPrice) <= 0) return alert('请输入有效的销售单价');

    setIsSubmitting(true);
    try {
      let finalProductId = matchedProduct?.id;
      const salePrice = parseFloat(manualPrice);

      // 🚀 核心逻辑：如果是新商品，先执行创建
      if (isNewProduct) {
        const newCostPrice = parseFloat(costPrice) || 0;
        const newInitStock = parseInt(initStock, 10) || 0;

        if (newCostPrice <= 0) {
          alert('新商品请填写有效的成本价');
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
      const success = await addSale(finalProductId, quantity, salesperson, undefined, overrideTotal);
      
      if (success) {
        alert(isNewProduct ? `已创建新商品 "${searchTerm}" 并完成售卖！` : '销售记录已成功添加！');
        // 重置表单（不重置销售员）
        setSearchTerm('');
        setSelectedProductId('');
        setQuantity(1);
        setManualPrice('');
        setCostPrice('');
        setInitStock('');
        setSelectedCategoryId('');
      } else {
        alert('销售失败，请检查系统日志。');
      }
    } catch (error) {
      console.error("Checkout error:", error);
      alert('提交过程中发生错误，请重试。');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ShoppingBag className="w-6 h-6 text-emerald-500" />
            快速售卖 & 录入
          </h2>
          <p className="text-slate-500 mt-1">输入名称可直接选择或创建新商品</p>
        </div>

        <form onSubmit={handleCheckout} className="p-6 space-y-5">
          {/* 销售人员（置顶，结算后不清空） */}
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
    </div>
  );
}
