import type { Product, Sale } from '../types';

export const getSaleUnitPrice = (sale: Sale): number => {
  const qty = Number(sale.quantity) || 0;
  const amount = Number(sale.totalAmount) || 0;
  if (qty <= 0 || amount <= 0) return 0;
  return amount / qty;
};

export const buildHistoricalPriceMap = (sales: Sale[]): Map<string, number> => {
  const agg = new Map<string, { sum: number; count: number }>();

  for (const sale of sales) {
    const unitPrice = getSaleUnitPrice(sale);
    if (unitPrice <= 0) continue;
    const current = agg.get(sale.productId) || { sum: 0, count: 0 };
    current.sum += unitPrice;
    current.count += 1;
    agg.set(sale.productId, current);
  }

  const result = new Map<string, number>();
  for (const [productId, { sum, count }] of agg.entries()) {
    if (count > 0) {
      result.set(productId, sum / count);
    }
  }
  return result;
};

export const getReferencePrice = (params: {
  product?: Product;
  historicalPrice?: number;
}): number => {
  const { product, historicalPrice } = params;
  const history = Number(historicalPrice) || 0;
  const costFloor = Math.max(0, (Number(product?.cost_price) || 0) * 1);
  const fallbackPrice = Math.max(0, Number(product?.price) || 0);
  return Math.max(history, costFloor, fallbackPrice);
};