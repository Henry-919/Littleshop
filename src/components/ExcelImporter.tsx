import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useStore } from '../hooks/useStore';
import { Upload, Loader2, FileSpreadsheet, CheckCircle2 } from 'lucide-react';

export function ExcelImporter({ store }: { store: ReturnType<typeof useStore> }) {
  const { processExcelImport, fetchData } = store;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState('');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setProgress('正在读取文件...');

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        
        // 将 Excel 转换为 JSON 对象数组
        const data = XLSX.utils.sheet_to_json(ws);
        
        if (data.length === 0) {
          alert('Excel 文件似乎是空的');
          return;
        }

        // 🚀 调用 store 中统一的导入逻辑
        // 这样可以确保导入后，store 里的 products 和 categories 状态同步更新
        const successCount = await processExcelImport(data, (msg) => setProgress(msg));
        
        alert(`导入成功！共处理 ${successCount} 件商品。`);
        
        // 确保 UI 彻底刷新
        if (fetchData) await fetchData();

      } catch (err) {
        console.error('Excel Import Error:', err);
        alert('解析 Excel 失败，请确保格式正确（包含：商品名称、类目、销售价、成本价、库存数量）');
      } finally {
        setImporting(false);
        setProgress('');
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.onerror = () => {
      alert('文件读取出错');
      setImporting(false);
    };

    reader.readAsBinaryString(file);
  };

  return (
    <div className="flex items-center gap-3">
      <input 
        type="file" 
        accept=".xlsx, .xls" 
        className="hidden" 
        ref={fileInputRef}
        onChange={handleFileUpload}
      />
      
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={importing}
        className={`px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 shadow-sm
          ${importing 
            ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
            : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 active:scale-95'
          }`}
      >
        {importing ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <FileSpreadsheet className="w-5 h-5" />
        )}
        {importing ? '正在导入...' : '导入 Excel'}
      </button>

      {importing && (
        <div className="flex items-center gap-2 animate-pulse">
          <span className="text-sm text-indigo-600 font-medium bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">
            {progress}
          </span>
        </div>
      )}
    </div>
  );
}