import React, { useState, useRef } from 'react';
import { useStore } from '../hooks/useStore';
import { Camera, Upload, CheckCircle, AlertCircle, Loader2, Save, X } from 'lucide-react';

export function ReceiptScanner({ store }: { store: ReturnType<typeof useStore> }) {
  const { products, addSale } = store;
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    items: { productName: string; unitPrice: number; quantity: number; totalAmount: number; matchedProductId?: string; hasMathDiscrepancy?: boolean }[];
    saleDate?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [salesperson, setSalesperson] = useState('Auto-Scanner');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1600;
          const MAX_HEIGHT = 1600;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = (error) => reject(error);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length > 0) {
      try {
        setLoading(true);
        const compressedImages = await Promise.all(files.map(file => compressImage(file)));
        setImages(prev => [...prev, ...compressedImages]);
        setResult(null);
        setError(null);
      } catch (err) {
        console.error('Image compression error:', err);
        setError('Failed to process image files.');
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

        // Call the new Vercel Serverless Function
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ base64Data, mimeType }),
        });

        const parsed = await response.json();

        if (!response.ok) {
          throw new Error(parsed.error || "Failed to process image");
        }

        if (parsed.error) {
          throw new Error(parsed.error);
        } else {
          const matchedItems = parsed.items?.map((item: any) => {
            // Rule 1: Math check
            const calculatedTotal = item.unitPrice * item.quantity;
            const hasMathDiscrepancy = Math.abs(calculatedTotal - item.totalAmount) > 0.01;
            const finalUnitPrice = hasMathDiscrepancy ? (item.totalAmount / item.quantity) : item.unitPrice;

            // Rule 2: Match product or CREATE_NEW
            const matchedProduct = products.find(p => 
              p.name.toLowerCase().includes(item.productName.toLowerCase()) || 
              item.productName.toLowerCase().includes(p.name.toLowerCase())
            );

            return {
              productName: item.productName,
              unitPrice: finalUnitPrice,
              quantity: item.quantity,
              totalAmount: item.totalAmount,
              hasMathDiscrepancy,
              matchedProductId: matchedProduct ? matchedProduct.id : 'CREATE_NEW'
            };
          }) || [];
          
          allMatchedItems = [...allMatchedItems, ...matchedItems];
          
          // Rule 3: Date fallback
          if (!finalDate && parsed.saleDate) {
            let d = parsed.saleDate;
            if (d.length === 5) { // e.g. 05-12
              d = `2026-${d}`;
            }
            finalDate = d;
          }
        }
      }
      
      if (navigator.vibrate) navigator.vibrate(100);
      
      setResult({
        items: allMatchedItems,
        saleDate: finalDate
      });
    } catch (err: any) {
      console.error('Detailed OCR Error:', err);
      setError(err.message || "An error occurred while processing the images. Please check the console for details.");
    } finally {
      setLoading(false);
    }
  };

  const handleMatchChange = (index: number, productId: string) => {
    if (!result) return;
    const newItems = [...result.items];
    newItems[index].matchedProductId = productId;
    setResult({ ...result, items: newItems });
  };

  const handleSave = async () => {
    if (!result) return;
    
    const itemsToProcess = result.items
      .filter(i => i.matchedProductId && i.matchedProductId !== '')
      .map(i => ({
        productId: i.matchedProductId!,
        productName: i.productName,
        price: i.unitPrice,
        quantity: i.quantity,
        totalAmount: i.totalAmount
      }));

    if (itemsToProcess.length === 0) {
      alert('No items selected to record.');
      return;
    }

    const dateToUse = result.saleDate ? new Date(result.saleDate).toISOString() : new Date().toISOString();
    
    const failedItems = await store.processReceiptSales(itemsToProcess, salesperson, dateToUse);
    
    if (failedItems.length === 0) {
      if (navigator.vibrate) navigator.vibrate(100);
      alert('All items recorded successfully!');
      setImages([]);
      setResult(null);
    } else {
      alert(`Failed to record some items due to insufficient stock:\n${failedItems.join('\n')}`);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="p-6 bg-white rounded-2xl shadow-sm border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900">Scan Receipt</h2>
        <p className="text-slate-500 mt-1">Upload photos of receipts to automatically extract and record sales.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Upload Section */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col min-h-[400px]">
          {images.length > 0 ? (
            <div className="w-full space-y-4 flex-1 flex flex-col">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 overflow-y-auto max-h-[300px] p-2">
                {images.map((img, idx) => (
                  <div key={idx} className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-50 aspect-square flex items-center justify-center">
                    <img src={img} alt={`Receipt ${idx + 1}`} className="max-h-full object-cover" />
                    <button 
                      onClick={() => {
                        const newImages = [...images];
                        newImages.splice(idx, 1);
                        setImages(newImages);
                        if (newImages.length === 0) setResult(null);
                      }}
                      className="absolute top-1 right-1 p-1 bg-white/80 hover:bg-white rounded-full text-slate-700 shadow-sm"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <div 
                  className="relative rounded-xl overflow-hidden border-2 border-dashed border-slate-300 bg-slate-50 aspect-square flex flex-col items-center justify-center cursor-pointer hover:bg-slate-100 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-6 h-6 text-slate-400 mb-2" />
                  <span className="text-xs text-slate-500 font-medium">Add More</span>
                </div>
              </div>
              <div className="mt-auto pt-4 border-t border-slate-100">
                <button
                  onClick={processImage}
                  disabled={loading}
                  className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white rounded-xl font-bold transition-colors shadow-sm flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
                  {loading ? 'Analyzing Images...' : `Extract Data (${images.length} images)`}
                </button>
              </div>
            </div>
          ) : (
            <div 
              className="w-full h-full flex-1 border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center justify-center p-8 text-center hover:bg-slate-50 transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-4">
                <Upload className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">Upload Receipt Photos</h3>
              <p className="text-sm text-slate-500 mb-6">Click or drag and drop images here. You can upload multiple receipts.</p>
              <button className="px-6 py-2 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors">
                Select Files
              </button>
            </div>
          )}
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImageUpload} 
            accept="image/*" 
            multiple
            className="hidden" 
          />
        </div>

        {/* Results Section */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col min-h-[400px]">
          <h3 className="text-lg font-bold text-slate-900 mb-4">Extracted Data</h3>
          
          {error && (
            <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-red-700 mb-4">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {!result && !error && !loading && (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
              <CheckCircle className="w-12 h-12 mb-2 opacity-20" />
              <p>Data will appear here after extraction</p>
            </div>
          )}

          {loading && (
            <div className="flex-1 flex flex-col items-center justify-center text-emerald-500">
              <Loader2 className="w-10 h-10 animate-spin mb-4" />
              <p className="font-medium">Gemini is analyzing the receipts...</p>
            </div>
          )}

          {result && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="mb-4 flex items-center gap-2">
                <span className="text-sm font-medium text-slate-500">Sale Date:</span>
                <span className="text-sm font-bold text-slate-900">{result.saleDate || 'Not found'}</span>
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                {result.items.map((item, index) => (
                  <div key={index} className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-bold text-slate-900">{item.productName}</p>
                        <p className="text-sm text-slate-500">{item.quantity} x ${Number(item.unitPrice || 0).toFixed(2)}</p>
                      </div>
                      <p className="font-bold text-emerald-600">${Number(item.totalAmount || 0).toFixed(2)}</p>
                    </div>
                    
                    {item.hasMathDiscrepancy && (
                      <div className="text-xs text-amber-600 flex items-start gap-1.5 bg-amber-50 p-2 rounded-lg border border-amber-100">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>金额异常：单价×数量不等于总金额。已优先采用总金额计算。</span>
                      </div>
                    )}
                    
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Match with Inventory</label>
                      <select 
                        value={item.matchedProductId || ''}
                        onChange={(e) => handleMatchChange(index, e.target.value)}
                        className="w-full p-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
                      >
                        <option value="CREATE_NEW">[+] 新商品待分类 (Create New)</option>
                        <option value="">-- Ignore / Do not record --</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.stock} in stock)
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100">
                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Salesperson</label>
                  <input
                    type="text"
                    value={salesperson}
                    onChange={(e) => setSalesperson(e.target.value)}
                    className="w-full p-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <button
                  onClick={handleSave}
                  disabled={!result.items.some(i => i.matchedProductId)}
                  className="w-full py-3 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-xl font-bold transition-colors shadow-sm flex items-center justify-center gap-2"
                >
                  <Save className="w-5 h-5" />
                  Record Selected Items
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
