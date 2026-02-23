import React, { useState, useRef } from 'react';
import { useStore } from '../hooks/useStore';
import { Camera, Upload, CheckCircle, AlertCircle, Loader2, Save, X, Plus } from 'lucide-react';

// 相似度算法：用于匹配现有库存商品
const getSimilarity = (a: string, b: string): number => {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  if (aLower === bLower) return 1;
  if (aLower.includes(bLower) || bLower.includes(aLower)) return 0.8;
  return 0; // 简化版，可根据需要替换回 Levenshtein
};

export function ReceiptScanner({ store }: { store: any }) {
  const { products, addSale, addProduct } = store;
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    items: any[];
    saleDate?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [salesperson, setSalesperson] = useState('自动扫描');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 1. 图片处理：压缩并转为 Base64
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setLoading(true);
    try {
      const readers = files.map(file => {
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target?.result as string);
          reader.readAsDataURL(file);
        });
      });
      const base64Images = await Promise.all(readers);
      setImages(prev => [...prev, ...base64Images]);
    } catch (err) {
      setError("图片读取失败");
    } finally {
      setLoading(false);
    }
  };

  // 2. 调用后端 AI 接口
  const processImage = async () => {
    if (images.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      let allItems: any[] = [];
      let detectedDate = "";

      for (const img of images) {
        // 核心修复：只发送 Base64 数据部分，去掉 data:image/jpeg;base64,
        const base64Data = img.split(',')[1];
        
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64Data, mimeType: "image/jpeg" }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "AI 解析失败");

        // 匹配逻辑
        const matched = data.items.map((item: any) => {
          let bestMatch = products.find((p: any) => getSimilarity(p.name, item.productName) > 0.7);
          return {
            ...item,
            matchedProductId: bestMatch ? bestMatch.id : 'CREATE_NEW',
            hasMathDiscrepancy: Math.abs(item.unitPrice * item.quantity - item.totalAmount) > 0.1
          };
        });

        allItems = [...allItems, ...matched];
        if (data.saleDate) detectedDate = data.saleDate;
      }

      setResult({ items: allItems, saleDate: detectedDate });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 3. 保存到数据库
  const handleSave = async () => {
    if (!result) return;
    setLoading(true);
    try {
      for (const item of result.items) {
        let finalId = item.matchedProductId;
        // 如果是新商品，先创建
        if (finalId === 'CREATE_NEW') {
          const { data: newProd } = await addProduct({
            name: item.productName,
            price: item.unitPrice,
            stock: 0
          });
          finalId = newProd.id;
        }
        // 记录销售
        await addSale(finalId, item.quantity, salesperson, result.saleDate);
      }
      alert("入库成功！");
      setResult(null);
      setImages([]);
    } catch (err) {
      alert("保存失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-4">
      {/* 顶部控制栏 */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Camera className="text-emerald-500" /> 手写小票识别
        </h2>
        <p className="text-slate-500 text-sm mt-1">上传 WANG YUWU INTERNATIONAL SPC 发票照片</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 左侧：上传预览 */}
        <div className="space-y-4">
          <div 
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center hover:bg-slate-50 cursor-pointer transition-all"
          >
            <input type="file" ref={fileInputRef} hidden multiple onChange={handleImageUpload} accept="image/*" />
            <Upload className="mx-auto w-10 h-10 text-slate-300 mb-2" />
            <span className="text-sm text-slate-600">点击或拖拽上传发票</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {images.map((img, i) => (
              <div key={i} className="relative aspect-square rounded-lg overflow-hidden border">
                <img src={img} className="object-cover w-full h-full" />
                <button onClick={() => setImages(images.filter((_, idx) => idx !== i))} className="absolute top-1 right-1 bg-white rounded-full p-1 shadow"><X size={12}/></button>
              </div>
            ))}
          </div>

          {images.length > 0 && (
            <button 
              onClick={processImage} 
              disabled={loading}
              className="w-full py-3 bg-emerald-500 text-white rounded-xl font-bold disabled:opacity-50 flex justify-center items-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin" /> : <CheckCircle size={20} />}
              {loading ? "AI 深度识别中..." : "开始识别小票"}
            </button>
          )}
        </div>

        {/* 右侧：识别结果 */}
        <div className="bg-slate-50 rounded-2xl p-4 min-h-[300px]">
          {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-xs flex items-center gap-2"><AlertCircle size={14}/>{error}</div>}
          
          {result ? (
            <div className="space-y-3">
              <div className="flex justify-between text-sm font-medium border-b pb-2">
                <span>识别日期: {result.saleDate || '未检测到'}</span>
                <span>共 {result.items.length} 项</span>
              </div>
              <div className="max-h-[400px] overflow-y-auto space-y-2">
                {result.items.map((item, idx) => (
                  <div key={idx} className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                    <div className="flex justify-between items-start">
                      <span className="font-bold text-slate-800">{item.productName}</span>
                      <span className="text-emerald-600 font-bold">￥{item.totalAmount}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {item.quantity} x ￥{item.unitPrice}
                    </div>
                    <select 
                      value={item.matchedProductId}
                      onChange={(e) => {
                        const newItems = [...result.items];
                        newItems[idx].matchedProductId = e.target.value;
                        setResult({...result, items: newItems});
                      }}
                      className="w-full mt-2 p-1 text-[10px] border rounded bg-slate-50"
                    >
                      <option value="CREATE_NEW">✨ 作为新商品入库</option>
                      {products.map((p: any) => <option key={p.id} value={p.id}>匹配: {p.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <button onClick={handleSave} className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold mt-4 flex items-center justify-center gap-2">
                <Save size={18} /> 确认保存到销售额
              </button>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm italic">
              <p>暂无识别结果</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}