import React from 'react';
import { useStore } from '../hooks/useStore';
import { Trash2 } from 'lucide-react';

export function SalesHistory({ store }: { store: ReturnType<typeof useStore> }) {
  const { sales, products, deleteSale } = store;

  const getProductName = (id: string) => {
    return products.find(p => p.id === id)?.name || 'Unknown Product';
  };

  const handleDelete = async (saleId: string, productId: string, quantity: number) => {
    if (window.confirm('Are you sure you want to delete this sale? The product stock will be restored.')) {
      await deleteSale(saleId, productId, quantity);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-6 border-b border-slate-100">
        <h2 className="text-2xl font-bold text-slate-900">Sales History</h2>
        <p className="text-slate-500 mt-1">Recent transactions</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-sm uppercase tracking-wider">
              <th className="px-6 py-4 font-medium">Date</th>
              <th className="px-6 py-4 font-medium">Product</th>
              <th className="px-6 py-4 font-medium">Quantity</th>
              <th className="px-6 py-4 font-medium">Total Amount</th>
              <th className="px-6 py-4 font-medium">Salesperson</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="text-slate-700 divide-y divide-slate-100">
            {sales.map(sale => {
              const productId = sale.productId || sale.product_id;
              const totalAmount = sale.totalAmount || sale.total_amount || 0;
              const date = sale.date || sale.created_at;

              return (
                <tr key={sale.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4 text-sm text-slate-500">
                    {date ? new Date(date).toLocaleString() : '-'}
                  </td>
                  <td className="px-6 py-4 font-medium">{getProductName(productId)}</td>
                  <td className="px-6 py-4">{sale.quantity}</td>
                  <td className="px-6 py-4 font-bold text-emerald-600">
                    ${Number(totalAmount).toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-sm">{sale.salesperson || '-'}</td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => handleDelete(sale.id, productId, sale.quantity)}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors inline-flex items-center justify-center"
                      title="Delete Sale"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {sales.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                  No sales recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
