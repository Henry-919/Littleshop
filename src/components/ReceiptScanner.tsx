import React, { useState, useRef } from 'react';
import { useStore } from '../hooks/useStore';
import { Camera, Upload, CheckCircle, AlertCircle, Loader2, Save, X } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';

export function ReceiptScanner({ store }: { store: ReturnType<typeof useStore> }) {
  const { products, addSale } = store;
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    items: { productName: string; unitPrice: number; quantity: number; totalAmount: number; matchedProductId?: string; hasMathDiscrepancy?: boolean }[];
    saleDate?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [salesperson, setSalesperson] = useState('Auto-Scanner');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
        setResult(null);
        setError(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const processImage = async () => {
    if (!image) return;
    setLoading(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });
      
      const base64Data = image.split(',')[1];
      const mimeType = image.split(';')[0].split(':')[1];

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: mimeType
              }
            },
            {
              text: "Extract the following information from this receipt/invoice: product name, unit price, quantity, total amount, and sale date. If the year is missing from the date, default to 2026. Format date as YYYY-MM-DD. If the image is blurry, unreadable, or missing key information, provide an error message explaining what is missing."
            }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    productName: { type: Type.STRING },
                    unitPrice: { type: Type.NUMBER },
                    quantity: { type: Type.NUMBER },
                    totalAmount: { type: Type.NUMBER }
                  },
                  required: ["productName", "unitPrice", "quantity", "totalAmount"]
                }
              },
              saleDate: { type: Type.STRING, description: "Date of the sale in YYYY-MM-DD format" },
              error: { type: Type.STRING, description: "Error message if information is missing or blurry" }
            }
          }
        }
      });

      const jsonStr = response.text;
      if (jsonStr) {
        const parsed = JSON.parse(jsonStr);
        if (parsed.error) {
          setError(parsed.error);
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
          
          // Rule 3: Date fallback
          let finalDate = parsed.saleDate;
          if (finalDate && finalDate.length === 5) { // e.g. 05-12
            finalDate = `2026-${finalDate}`;
          }
          
          if (navigator.vibrate) navigator.vibrate(100);
          
          setResult({
            items: matchedItems,
            saleDate: finalDate
          });
        }
      } else {
        setError("Failed to parse the receipt.");
      }
    } catch (err) {
      console.error(err);
      setError("An error occurred while processing the image.");
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

  const handleSave = () => {
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
    
    const failedItems = store.processReceiptSales(itemsToProcess, salesperson, dateToUse);
    
    if (failedItems.length === 0) {
      if (navigator.vibrate) navigator.vibrate(100);
      alert('All items recorded successfully!');
      setImage(null);
      setResult(null);
    } else {
      alert(`Failed to record some items due to insufficient stock:\n${failedItems.join('\n')}`);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="p-6 bg-white rounded-2xl shadow-sm border border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900">Scan Receipt</h2>
        <p className="text-slate-500 mt-1">Upload a photo of a receipt to automatically extract and record sales.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Upload Section */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center justify-center min-h-[400px]">
          {image ? (
            <div className="w-full space-y-4">
              <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-50 flex items-center justify-center h-64">
                <img src={image} alt="Receipt" className="max-h-full object-contain" />
                <button 
                  onClick={() => { setImage(null); setResult(null); setError(null); }}
                  className="absolute top-2 right-2 p-1.5 bg-white/80 hover:bg-white rounded-full text-slate-700 shadow-sm"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <button
                onClick={processImage}
                disabled={loading}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white rounded-xl font-bold transition-colors shadow-sm flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
                {loading ? 'Analyzing Image...' : 'Extract Data'}
              </button>
            </div>
          ) : (
            <div 
              className="w-full h-full border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center justify-center p-8 text-center hover:bg-slate-50 transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-4">
                <Upload className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">Upload Receipt Photo</h3>
              <p className="text-sm text-slate-500 mb-6">Click or drag and drop an image here</p>
              <button className="px-6 py-2 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors">
                Select File
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleImageUpload} 
                accept="image/*" 
                className="hidden" 
              />
            </div>
          )}
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
              <p className="font-medium">Gemini is analyzing the receipt...</p>
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
