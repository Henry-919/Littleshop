import React, { useState, useRef } from 'react';
import { useStore } from '../hooks/useStore';
import { Package, AlertTriangle, Plus, Trash2, X, Upload, History, RotateCcw } from 'lucide-react';
import * as XLSX from 'xlsx';

export function Inventory({ store }: { store: ReturnType<typeof useStore> }) {
  const { products, categories, addProduct, deleteProduct, restoreProduct, processExcelImport, loading } = store;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'active' | 'deleted'>('active');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newProduct, setNewProduct] = useState({
    name: '',
    price: '',
    cost_price: '',
    stock: '',
    category_id: ''
  });

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProduct.name || !newProduct.price || !newProduct.stock) return;
    
    await addProduct({
      name: newProduct.name,
      price: parseFloat(newProduct.price),
      cost_price: parseFloat(newProduct.cost_price || '0'),
      stock: parseInt(newProduct.stock, 10),
      category_id: newProduct.category_id || undefined
    });
    
    setIsModalOpen(false);
    setNewProduct({ name: '', price: '', cost_price: '', stock: '', category_id: '' });
  };

  const handleDelete = async (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to delete "${name}"?`)) {
      await deleteProduct(id);
    }
  };

  const handleRestore = async (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to restore "${name}"?`)) {
      await restoreProduct(id);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setImporting(true);
      setImportProgress('Reading file...');
      
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const bstr = evt.target?.result;
          const wb = XLSX.read(bstr, { type: 'binary' });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const data = XLSX.utils.sheet_to_json(ws);
          
          if (data.length === 0) {
            alert('The Excel file is empty.');
            setImporting(false);
            return;
          }

          const successCount = await processExcelImport(data, setImportProgress);
          alert(`Import complete! Successfully processed ${successCount} products.`);
        } catch (err) {
          console.error(err);
          alert('Failed to process Excel file. Please check the format.');
        } finally {
          setImporting(false);
          setImportProgress('');
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.readAsBinaryString(file);
    } catch (err) {
      console.error(err);
      setImporting(false);
      setImportProgress('');
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Loading inventory data from Supabase...</div>;
  }

  const displayedProducts = products.filter(p => viewMode === 'active' ? !p.is_deleted : p.is_deleted);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Inventory Management</h2>
          <p className="text-slate-500 mt-1">Track and manage your product stock</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
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
          
          <button
            onClick={() => setViewMode(viewMode === 'active' ? 'deleted' : 'active')}
            className={`px-4 py-2 rounded-xl font-medium transition-colors flex items-center gap-2 ${
              viewMode === 'deleted' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <History className="w-5 h-5" />
            {viewMode === 'active' ? 'View Deleted' : 'View Active'}
          </button>

          <button
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold transition-colors shadow-sm flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            New Product
          </button>
        </div>
      </div>

      {importing && (
        <div className="p-4 bg-indigo-50 text-indigo-700 rounded-xl border border-indigo-100 flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-indigo-600 border-t-transparent"></div>
          <span className="font-medium">{importProgress}</span>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-sm uppercase tracking-wider">
                <th className="px-6 py-4 font-medium">Product Name</th>
                <th className="px-6 py-4 font-medium">Category</th>
                <th className="px-6 py-4 font-medium">Price</th>
                <th className="px-6 py-4 font-medium">Cost Price</th>
                <th className="px-6 py-4 font-medium">Stock Level</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-slate-700 divide-y divide-slate-100">
              {displayedProducts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                    No products found in this view.
                  </td>
                </tr>
              )}
              {displayedProducts.map(product => {
                const isLowStock = product.stock < 5;
                const category = categories?.find(c => c.id === product.category_id);
                return (
                  <tr key={product.id} className={`transition-colors ${viewMode === 'deleted' ? 'bg-slate-50 opacity-75' : 'hover:bg-slate-50/50'}`}>
                    <td className="px-6 py-4 font-medium">{product.name}</td>
                    <td className="px-6 py-4 text-slate-500">
                      {category ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
                          {category.name}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-6 py-4">${product.price.toFixed(2)}</td>
                    <td className="px-6 py-4">${(product.cost_price || 0).toFixed(2)}</td>
                    <td className={`px-6 py-4 font-bold ${isLowStock && viewMode === 'active' ? 'text-red-600' : 'text-slate-700'}`}>
                      <div className="flex items-center gap-2">
                        <span>{product.stock}</span>
                        {isLowStock && viewMode === 'active' && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Low Stock
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {viewMode === 'active' ? (
                        <button
                          onClick={() => handleDelete(product.id, product.name)}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors inline-flex items-center justify-center"
                          title="Delete Product"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleRestore(product.id, product.name)}
                          className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors inline-flex items-center justify-center gap-2 text-sm font-medium"
                          title="Restore Product"
                        >
                          <RotateCcw className="w-4 h-4" />
                          Restore
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Product Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h3 className="text-xl font-bold text-slate-900">Add New Product</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleAddProduct} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Product Name</label>
                <input
                  type="text"
                  required
                  value={newProduct.name}
                  onChange={e => setNewProduct({...newProduct, name: e.target.value})}
                  className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                <select
                  value={newProduct.category_id}
                  onChange={e => setNewProduct({...newProduct, category_id: e.target.value})}
                  className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
                >
                  <option value="">-- No Category --</option>
                  {categories?.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Selling Price ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={newProduct.price}
                    onChange={e => setNewProduct({...newProduct, price: e.target.value})}
                    className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Cost Price ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newProduct.cost_price}
                    onChange={e => setNewProduct({...newProduct, cost_price: e.target.value})}
                    className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Initial Stock</label>
                <input
                  type="number"
                  required
                  value={newProduct.stock}
                  onChange={e => setNewProduct({...newProduct, stock: e.target.value})}
                  className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div className="pt-4">
                <button
                  type="submit"
                  className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold transition-colors shadow-sm"
                >
                  Save Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
