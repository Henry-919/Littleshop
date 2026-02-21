import React from 'react';
import { useStore } from '../hooks/useStore';

export function SalesHistory({ store }: { store: ReturnType<typeof useStore> }) {
  const { sales, products } = store;

  const getProductName = (id: string) => {
    return products.find(p => p.id === id)?.name || 'Unknown Product';
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
            </tr>
          </thead>
          <tbody className="text-slate-700 divide-y divide-slate-100">
            {sales.map(sale => (
              <tr key={sale.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4 text-sm text-slate-500">
                  {new Date(sale.date).toLocaleString()}
                </td>
                <td className="px-6 py-4 font-medium">{getProductName(sale.productId)}</td>
                <td className="px-6 py-4">{sale.quantity}</td>
                <td className="px-6 py-4 font-bold text-emerald-600">
                  ${sale.totalAmount.toFixed(2)}
                </td>
                <td className="px-6 py-4 text-sm">{sale.salesperson}</td>
              </tr>
            ))}
            {sales.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
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
