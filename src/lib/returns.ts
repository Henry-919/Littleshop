import { supabase } from './supabase';

export type ReturnRecord = {
  id: string;
  productId?: string;
  productModel: string;
  invoiceNo: string;
  amount: number;
  quantity: number;
  returnDate: string;
  createdAt: string;
  storeId?: string;
};

const RETURN_CHANGED_EVENT = 'littleshop:return-changed';

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeRecord = (item: any, index = 0): ReturnRecord | null => {
  if (!item || typeof item !== 'object') return null;

  const amount = toNumber(item.amount, 0);
  const quantity = Math.max(1, Math.floor(toNumber(item.quantity, 1)));
  const productId = item.product_id || item.productId ? String(item.product_id || item.productId) : undefined;
  const productModel = String(item.product_model || item.productModel || '').trim();
  const invoiceNo = String(item.invoice_no || item.invoiceNo || '').trim();
  const returnDate = String(item.return_date || item.returnDate || '').trim();
  const createdAt = String(item.created_at || item.createdAt || '').trim() || new Date().toISOString();
  const storeId = item.store_id || item.storeId ? String(item.store_id || item.storeId) : undefined;

  if (!productModel || !invoiceNo || !returnDate) return null;

  return {
    id: String(item.id || `${createdAt}-${index}`),
    productId,
    productModel,
    invoiceNo,
    amount,
    quantity,
    returnDate,
    createdAt,
    storeId
  };
};

export const loadMergedReturns = async (storeId?: string): Promise<ReturnRecord[]> => {
  if (!storeId) return [];

  const { data, error } = await supabase
    .from('returns')
    .select('id, store_id, product_id, product_model, invoice_no, amount, quantity, return_date, created_at')
    .eq('store_id', storeId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(2000);

  if (error) return [];

  return (data || [])
    .map((item, index) => normalizeRecord(item, index))
    .filter((item): item is ReturnRecord => !!item)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 2000);
};

export const emitReturnsChanged = (storeId?: string) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(RETURN_CHANGED_EVENT, { detail: { storeId } }));
};

export const subscribeReturnsChanged = (handler: (storeId?: string) => void) => {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    const custom = event as CustomEvent<{ storeId?: string }>;
    handler(custom?.detail?.storeId);
  };
  window.addEventListener(RETURN_CHANGED_EVENT, listener as EventListener);
  return () => window.removeEventListener(RETURN_CHANGED_EVENT, listener as EventListener);
};
