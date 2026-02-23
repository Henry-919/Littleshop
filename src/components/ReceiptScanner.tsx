import React, { useState, useRef } from 'react';
import { useStore } from '../hooks/useStore';
import { Camera, Upload, CheckCircle, AlertCircle, Loader2, Save, X, Tag } from 'lucide-react';

// 相似度计算算法保持不变
const levenshtein = (a: string, b: string): number => {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
      else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
    }
  }
  return matrix[b.length][a.length];
};

const getSimilarity = (a: string, b: string): number => {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  if (aLower === bLower) return 1;
  if (aLower.includes(bLower) || bLower.includes(aLower)) return 0.8;
  const distance = levenshtein(aLower, bLower);
  const maxLength = Math.max(aLower.length, bLower.length);
  return maxLength === 0 ? 1 : 1 - distance / maxLength;
};

export function ReceiptScanner({ store }: { store: ReturnType<typeof useStore> }) {
  const { products, addSale, addProduct } = store;
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    items: { productName: string; unitPrice: number; quantity: number; totalAmount: number; matchedProductId?: string; hasMathDiscrepancy?: boolean }[];
    saleDate?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [salesperson, setSalesperson] = useState('自动扫描');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 图片压缩逻辑
  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_SIZE = 1600;
          let width = img.width;
          let height = img.height;
          if (width > height) {
            if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
          } else {
            if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
          }
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
      };
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setLoading(true);
      try {
        const compressed = await Promise.all(files.map(compressImage));
        setImages(prev => [...prev, ...compressed]);
        setResult(null);
        setError(null);
      } catch (err) {
        setError('图片处理失败');
      } finally {
        setLoading(false);
      }
    }
  };

  const processImage = async () => {
    if (images.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      let allMatchedItems: any[] = [];
      let finalDate = '';

      for (const image of images) {
        const base64Data = image.split(',')[1];
        const mimeType = image.split(';')[0].split(':')[1];

        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64Data, mimeType }),
        });

        const parsed = await response.json();
        if (!response.ok) throw new Error(parsed.error || "扫描接口异常");

        const matchedItems = parsed.items?.map((item: any) => {
          const calculatedTotal = item.unitPrice * item.quantity;
          const hasMathDiscrepancy = Math.abs(calculatedTotal - item.totalAmount) > 0.01;
          const finalUnitPrice = hasMathDiscrepancy ? (item.totalAmount / item.quantity) : item.unitPrice;

          let bestMatch = null;
          let highestSimilarity = 0;
          for (const p of products) {
            const sim = getSimilarity(p.name, item.productName);
            if (sim > highestSimilarity) { highestSimilarity = sim; bestMatch = p; }
          }

          return {
            productName: item.productName,
            unitPrice: finalUnitPrice,
            quantity: item.quantity,
            totalAmount: item.totalAmount,
            hasMathDiscrepancy,
            matchedProductId: (highestSimilarity > 0.4 && bestMatch) ? bestMatch.id : 'CREATE_NEW'
          };
        }) || [];
        
        allMatchedItems = [...allMatchedItems, ...matchedItems];
        if (!finalDate && parsed.saleDate) finalDate = parsed.saleDate.length === 5 ? `2026-${parsed.saleDate}` : parsed.saleDate;
      }
      
      setResult({ items: allMatchedItems, saleDate: finalDate });
      if (navigator.vibrate) navigator.vibrate(100);
    } catch (err: any) {
      setError(err.message || "解析失败，请检查网络或图片清晰度");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!result) return;
    setLoading(true);
    
    try {
      const dateToUse = result.saleDate ? new Date(result.saleDate).toISOString() : new Date().toISOString();
      let successCount = 0;

      // 核心更新：循环处理，支持实时创建新商品并获得 ID
      for (const item of result.items) {
        if (!item.matchedProductId) continue;

        let finalId = item.matchedProductId;

        // 如果标记为新商品，先执行 addProduct
        if (finalId === 'CREATE_NEW') {
          const { data: newProd, error: addError } = await addProduct({
            name: item.productName,
            price: item.unitPrice,
            stock: 0, // 初始库存为0，因为是从小票扫描出来的销售
            cost_price: 0
          });
          if (addError || !newProd) {
            console.error(`无法创建商品: ${item.productName}`);
            continue;
          }
          finalId = newProd.id;
        }

        // 记录销售
        const saleSuccess = await addSale(finalId, item.quantity, salesperson, dateToUse);
        if (saleSuccess) successCount++;
      }

      alert(`处理完成：成功记录 ${successCount} 条销售记录`);
      setImages([]);
      setResult(null);
    } catch (err) {
      alert("保存过程中发生错误");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="p-6 bg-white rounded-2xl shadow-sm border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900">小票扫描录入</h2>
        <p className="text-slate-500 mt-1">上传纸质小票照片，AI 将自动识别商品、单价、数量并同步到销售记录。</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 左侧：图片上传区 */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col min-h-[450px]">
          {images.length > 0 ? (
            <div className="flex-1 flex flex-col">
              <div className="grid grid-cols-2 gap-4 overflow-y-auto max-h-[350px] p-2">
                {images.map((img, idx) => (
                  <div key={idx} className="relative rounded-xl overflow-hidden border border-slate-200 aspect-square">
                    <img src={img} className="w-full h-full object-cover" alt="receipt" />
                    <button onClick={() => {
                      const n = [...images]; n.splice(idx, 1); setImages(n);
                      if(n.length === 0) setResult(null);
                    }} className="absolute top-1 right-1 p-1 bg-white/90 rounded-full shadow-md"><X className="w-4 h-4"/></button>
                  </div>
                ))}
                <button onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center gap-2 hover:bg-slate-50 transition-colors">
                  <PlusIcon className="w-6 h-6 text-slate-400" />
                  <span className="text-xs font-medium text-slate-500">添加更多</span>
                </button>
              </div>
              <button onClick={processImage} disabled={loading} className="mt-auto w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-100 disabled:opacity-50">
                {loading ? <Loader2 className="animate-spin" /> : <Camera className="w-5 h-5" />}
                {loading ? 'AI 正在深度解析...' : `开始解析 (${images.length} 张小票)`}
              </button>
            </div>
          ) : (
            <div onClick={() => fileInputRef.current?.click()} className="flex-1 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center p-10 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/30 transition-all">
              <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-4"><Upload className="w-10 h-10" /></div>
              <h3 className="text-lg font-bold text-slate-900">上传小票照片</h3>
              <p className="text-sm text-slate-500 text-center mt-2">支持多张上传，系统将自动合并数据</p>
            </div>
          )}
          <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" multiple className="hidden" />
        </div>

        {/* 右侧：结果确认区 */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col min-h-[450px]">
          <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-emerald-500" /> 解析结果确认
          </h3>

          {error && <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl text-rose-700 text-sm mb-4 flex gap-2"><AlertCircle className="shrink-0 w-5 h-5"/>{error}</div>}

          {!result && !loading && (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 italic">
              <p>等待解析数据...</p>
            </div>
          )}

          {result && (
            <div className="flex-1 flex flex-col h-full">
              <div className="mb-4 p-3 bg-slate-50 rounded-lg flex justify-between items-center text-sm">
                <span className="text-slate-500">识别日期: <b className="text-slate-900">{result.saleDate || '未识别'}</b></span>
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                {result.items.map((item, idx) => (
                  <div key={idx} className="p-4 bg-white border border-slate-100 rounded-xl shadow-sm space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold text-slate-900">{item.productName}</h4>
                        <p className="text-xs text-slate-500">{item.quantity} 件 × ￥{item.unitPrice.toFixed(2)}</p>
                      </div>
                      <span className="font-black text-emerald-600 text-lg">￥{item.totalAmount.toFixed(2)}</span>
                    </div>

                    {item.hasMathDiscrepancy && (
                      <div className="text-[10px] bg-amber-50 text-amber-700 p-2 rounded border border-amber-100 flex gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0" /> 金额已按总价自动校正
                      </div>
                    )}

                    <select 
                      value={item.matchedProductId}
                      onChange={(e) => {
                        const n = [...result.items]; n[idx].matchedProductId = e.target.value;
                        setResult({...result, items: n});
                      }}
                      className="w-full p-2 text-xs border rounded-lg bg-slate-50 focus:bg-white transition-colors outline-none"
                    >
                      <option value="CREATE_NEW">✨ 存为新商品 (Auto Create)</option>
                      <option value="">🚫 忽略此行 (Ignore)</option>
                      <optgroup label="匹配现有库存">
                        {products.map(p => (
                          <option key={p.id} value={p.id}>{p.name} (库存: {p.stock})</option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                ))}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100 space-y-4">
                <input 
                  type="text" value={salesperson} 
                  onChange={e => setSalesperson(e.target.value)}
                  placeholder="销售人员姓名"
                  className="w-full p-3 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button onClick={handleSave} disabled={loading || !result.items.some(i => i.matchedProductId)} className="w-full py-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold flex items-center justify-center gap-2">
                  <Save className="w-5 h-5" /> 确认入库销售
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>;
}