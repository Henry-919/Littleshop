import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { Upload } from 'lucide-react';

export function ExcelImporter({ onImportComplete }: { onImportComplete?: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState('');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !supabase) return;

    try {
      setImporting(true);
      setProgress('Reading file...');
      
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const bstr = evt.target?.result;
          const wb = XLSX.read(bstr, { type: 'binary' });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const data = XLSX.utils.sheet_to_json(ws);
          
          let successCount = 0;

          for (let i = 0; i < data.length; i++) {
            const row: any = data[i];
            const name = row['商品名称'];
            const catName = row['类目'];
            const price = parseFloat(row['销售价'] || '0');
            const cost = parseFloat(row['成本价'] || '0');
            const stock = parseInt(row['库存数量'] || '0', 10);

            if (!name) continue;
            setProgress(`Processing ${i + 1}/${data.length}: ${name}`);

            // 1. Handle Category
            let categoryId = null;
            if (catName) {
              const { data: catData } = await supabase.from('categories').select('id').eq('name', catName).single();
              if (catData) {
                categoryId = catData.id;
              } else {
                const { data: newCat } = await supabase.from('categories').insert([{ name: catName }]).select('id').single();
                if (newCat) categoryId = newCat.id;
              }
            }

            // 2. Handle Product
            const { data: existingProd } = await supabase.from('products').select('id, stock').eq('name', name).single();
            
            if (existingProd) {
              await supabase.from('products')
                .update({ 
                  stock: existingProd.stock + stock, 
                  price, 
                  cost_price: cost, 
                  category_id: categoryId,
                  is_deleted: false
                })
                .eq('id', existingProd.id);
            } else {
              await supabase.from('products')
                .insert([{ 
                  name, 
                  price, 
                  cost_price: cost, 
                  stock, 
                  category_id: categoryId 
                }]);
            }
            successCount++;
          }
          
          alert(`Import complete! Successfully processed ${successCount} products.`);
          if (onImportComplete) onImportComplete();
        } catch (err) {
          console.error(err);
          alert('Failed to process Excel file.');
        } finally {
          setImporting(false);
          setProgress('');
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.readAsBinaryString(file);
    } catch (err) {
      console.error(err);
      setImporting(false);
      setProgress('');
    }
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
        className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-xl font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
      >
        <Upload className="w-5 h-5" />
        {importing ? 'Importing...' : 'Import Excel'}
      </button>
      {importing && <span className="text-sm text-indigo-600 font-medium">{progress}</span>}
    </div>
  );
}
