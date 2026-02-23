import React, { useState } from 'react';
import { useStore } from '../hooks/useStore';

export function POS({ store }: { store: ReturnType<typeof useStore> }) {
  const { products, addSale } = store;
  const [selectedProductId, setSelectedProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [salesperson, setSalesperson] = useState('');

  const selectedProduct = products.find(p => p.id === selectedProductId);

  const handleCheckout = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductId || !salesperson || quantity <= 0) {
      alert('Please fill in all fields correctly.');
      return;
    }
    
    const success = addSale(selectedProductId, quantity, salesperson);
    if (success) {
      if (navigator.vibrate) navigator.vibrate(100);
      alert('Sale recorded successfully!');
      setSelectedProductId('');
      setQuantity(1);
    } else {
      alert('Failed to record sale. Check stock availability.');
    }
  };

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-6 border-b border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900">Checkout</h2>
        <p className="text-slate-500 mt-1">Record a new sale</p>
      </div>
      <form onSubmit={handleCheckout} className="p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Select Product</label>
          <select
            value={selectedProductId}
            onChange={(e) => setSelectedProductId(e.target.value)}
            className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
            required
          >
            <option value="">-- Choose a product --</option>
            {products.map(p => (
              <option key={p.id} value={p.id} disabled={p.stock <= 0}>
                {p.name} - ${p.price.toFixed(2)} ({p.stock} in stock)
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Quantity</label>
            <input
              type="number"
              min="1"
              max={selectedProduct?.stock || 1}
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
              className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Salesperson</label>
            <input
              type="text"
              value={salesperson}
              onChange={(e) => setSalesperson(e.target.value)}
              placeholder="e.g. John Doe"
              className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
              required
            />
          </div>
        </div>

        {selectedProduct && (
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex justify-between items-center">
            <span className="text-slate-600 font-medium">Total Amount:</span>
            <span className="text-2xl font-bold text-emerald-600">
              ${(selectedProduct.price * quantity).toFixed(2)}
            </span>
          </div>
        )}

        <button
          type="submit"
          className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold text-lg transition-colors shadow-sm"
        >
          Complete Checkout
        </button>
      </form>
    </div>
  );
}
