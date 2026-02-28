import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Upload, Loader2, FileSpreadsheet } from 'lucide-react';

// 修复点：修改 Props 定义，使其既能接收 store，也能兼容回调
interface ExcelImporterProps {
  store?: any; 
  onImportComplete?: () => void;
}

export function ExcelImporter({ store, onImportComplete }: ExcelImporterProps) {
  // 防御性处理：防止 store 为空时崩溃
  const processExcelImport = store?.processExcelImport;
  const fetchData = store?.fetchData || onImportComplete;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState('');
  const [importMode, setImportMode] = useState<'increment' | 'overwrite'>('increment');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !processExcelImport) {
      if (!processExcelImport) alert("Store 导入功能未就绪");
      return;
    }

    setImporting(true);
    setProgress('正在读取文件...');

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        // 使用 try-catch 包裹解析过程
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        
        const data = XLSX.utils.sheet_to_json(ws);
        
        if (data.length === 0) {
          alert('Excel 文件似乎是空的');
          setImporting(false);
          return;
        }

        setProgress('正在同步到数据库...');
        const successCount = await processExcelImport(data, (msg: string) => setProgress(msg), importMode);
        
        alert(`导入成功！共处理 ${successCount} 条数据。`);
        
        // 刷新 UI
        if (typeof fetchData === 'function') {
          await fetchData();
        }

      } catch (err) {
        console.error('Excel Import Error:', err);
        alert('解析 Excel 失败，请确保格式正确（列名需包含：商品名称、类目、成本价、库存数量；销售价可为空）');
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
    <div className="flex items-center gap-3 flex-wrap">
      <select
        value={importMode}
        onChange={(e) => setImportMode(e.target.value as 'increment' | 'overwrite')}
        disabled={importing}
        className="h-11 px-3 border border-slate-200 rounded-xl text-sm text-slate-600 bg-white"
      >
        <option value="increment">增量入库</option>
        <option value="overwrite">覆盖库存</option>
      </select>

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
        className={`h-11 px-4 rounded-xl font-bold transition-all inline-flex items-center justify-center gap-2 shadow-sm border text-sm
          ${importing 
            ? 'bg-slate-50 text-slate-400 cursor-not-allowed border-slate-100' 
            : 'bg-white text-slate-700 hover:bg-slate-50 active:scale-95 border-slate-200'
          }`}
      >
        {importing ? (
          <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
        ) : (
          <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
        )}
        <span>{importing ? '处理中...' : '导入 Excel'}</span>
      </button>

      {importing && (
        <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
          <span className="text-[10px] text-indigo-600 font-black bg-indigo-50 px-2 py-1 rounded border border-indigo-100 uppercase">
            {progress}
          </span>
        </div>
      )}
    </div>
  );
}