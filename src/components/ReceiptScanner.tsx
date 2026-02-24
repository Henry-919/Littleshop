import React, { useState, useRef } from 'react';
import { useStore } from '../hooks/useStore';
import { Camera, Upload, CheckCircle, AlertCircle, Loader2, Save, X, Plus } from 'lucide-react';

// 1. 相似度算法：用于匹配现有库存商品
const getSimilarity = (a: string, b: string): number => {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  if (aLower === bLower) return 1;
  if (aLower.includes(bLower) || bLower.includes(aLower)) return 0.8;
  return 0;
};

// 2. 图片压缩工具函数：减少传输体积，大幅提升识别启动速度
const compressImage = (base64Str: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = 1500; // 足够清晰用于 OCR
      let width = img.width;
      let height = img.height;

      if (width > MAX_WIDTH) {
        height *= MAX_WIDTH / width;
        width = MAX_WIDTH;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error("Canvas context failed"));
      
      ctx.drawImage(img, 0, 0, width, height);
      // 导出为 jpeg 格式，质量 0.8，并只保留 base64 数据部分
      const compressed = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
      resolve(compressed);
    };
    img.onerror = () => reject(new Error("图片加载失败"));
  });
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

  // 图片上传处理
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

  // 核心：调用后端 AI 接口 (已优化为并发请求)
  const processImage = async () => {
    if (images.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      // 使用 Promise.all 并发处理所有图片，提速显著
      // 控制并发数并实现重试与超时
      const MAX_CONCURRENCY = 2;
      const RETRY_ATTEMPTS = 3;
      const TIMEOUT_MS = 60000;

      const semaphore = { count: 0 };
      const runWithConcurrency = async (fn: () => Promise<any>) => {
        while (semaphore.count >= MAX_CONCURRENCY) {
          await new Promise(r => setTimeout(r, 100));
        }
        semaphore.count++;
        try {
          return await fn();
        } finally {
          semaphore.count--;
        }
      };

      const fetchWithRetryAndTimeout = async (compressedBase64: string) => {
        let attempt = 0;
        while (attempt < RETRY_ATTEMPTS) {
          attempt++;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
          try {
            const response = await fetch('/api/analyze', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ base64Data: compressedBase64, mimeType: 'image/jpeg' }),
              signal: controller.signal,
            });
            clearTimeout(timer);
            if (response.status === 429) {
              // 等待并重试
              await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
              continue;
            }
            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
              const text = await response.text();
              throw new Error(`Server returned non-JSON response: ${text.slice(0,200)}`);
            }
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'AI 解析失败');
            return data;
          } catch (err: any) {
            clearTimeout(timer);
            if (err.name === 'AbortError') {
              // 超时，重试
              continue;
            }
            if (attempt >= RETRY_ATTEMPTS) throw err;
            await new Promise(r => setTimeout(r, 300 * attempt));
          }
        }
        throw new Error('AI 解析 - 达到重试上限');
      };

      const uploadPromises = images.map(async (img) => {
        const compressedBase64 = await compressImage(img);
        return runWithConcurrency(() => fetchWithRetryAndTimeout(compressedBase64));
      });

      const allResults = await Promise.all(uploadPromises);

      // 合并所有图片的识别结果
      let allItems: any[] = [];
      let detectedDate = "";

      allResults.forEach(data => {
        if (data.saleDate) detectedDate = data.saleDate;
        
        const matched = (data.items || []).map((item: any) => {
          const bestMatch = products.find((p: any) => getSimilarity(p.name, item.productName) > 0.7);
          return {
            ...item,
            matchedProductId: bestMatch ? bestMatch.id : 'CREATE_NEW',
            matchedProductName: bestMatch ? bestMatch.name : undefined,
            hasMathDiscrepancy: Math.abs(item.unitPrice * item.quantity - item.totalAmount) > 0.1
          };
        });
        allItems = [...allItems, ...matched];
      });

      setResult({ items: allItems, saleDate: detectedDate });
      if (allItems.some((item) => item.matchedProductId === 'CREATE_NEW')) {
        setError('存在未匹配商品，请先在库存中创建对应商品后再保存。');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 保存到数据库
  const handleSave = async () => {
    if (!result) return;
    if (result.items.some((item) => item.matchedProductId === 'CREATE_NEW')) {
      setError('存在未匹配商品，已阻止保存。请先在库存中创建对应商品后再保存。');
      return;
    }
    setLoading(true);
    try {
      for (const item of result.items) {
        let finalId = item.matchedProductId;
        if (finalId === 'CREATE_NEW') continue;
        await addSale(finalId, item.quantity, salesperson, result.saleDate);
      }
      alert("入库成功！");
      setResult(null);
      setImages([]);
      await store.fetchData(); // Refresh store data to update sales history
    } catch (err) {
      alert("保存失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-4">
      {/* 顶部控制栏 */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Camera className="text-emerald-500" /> 手写小票识别
          </h2>
          <p className="text-slate-500 text-sm mt-1">上传 WANG YUWU INTERNATIONAL SPC 发票照片</p>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <span className="text-sm font-medium text-slate-500 shrink-0">销售员:</span>
          <input 
            type="text" 
            value={salesperson} 
            onChange={(e) => setSalesperson(e.target.value)}
            placeholder="输入销售员姓名"
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500 w-full md:w-32"
          />
        </div>
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
              {loading ? "AI 并发深度识别中..." : "开始识别小票"}
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
                      {item.hasMathDiscrepancy && <span className="ml-2 text-amber-500 font-medium">⚠️ 金额校验异常</span>}
                    </div>
                    <div className="mt-2 text-[10px] text-slate-500">
                      {item.matchedProductId === 'CREATE_NEW'
                        ? '自动识别：未找到匹配商品，将作为新商品创建'
                        : `自动匹配：${item.matchedProductName || '已入库商品'}`}
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={handleSave} className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold mt-4 flex items-center justify-center gap-2">
                <Save size={18} /> 确认保存到销售额
              </button>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm italic">
              <p>{loading ? "AI 正在分析，请稍候..." : "暂无识别结果"}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}