import { supabase } from './supabase';

export type ReturnRecord = {
  id: string;
  productModel: string;
  invoiceNo: string;
  amount: number;
  quantity: number;
  returnDate: string;
  createdAt: string;
};

const RETURN_LOCAL_KEY = (storeId?: string) => `littleshop_return_records_${storeId || 'unknown'}`;
const RETURN_CHANGED_EVENT = 'littleshop:return-changed';

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeRecord = (item: any, index = 0): ReturnRecord | null => {
  if (!item || typeof item !== 'object') return null;

  const amount = toNumber(item.amount, 0);
  const quantity = Math.max(1, Math.floor(toNumber(item.quantity, 1)));
  const productModel = String(item.product_model || item.productModel || '').trim();
  const invoiceNo = String(item.invoice_no || item.invoiceNo || '').trim();
  const returnDate = String(item.return_date || item.returnDate || '').trim();
  const createdAt = String(item.created_at || item.createdAt || '').trim() || new Date().toISOString();

  if (!productModel || !invoiceNo || !returnDate) return null;

  return {
    id: String(item.id || `${createdAt}-${index}`),
    productModel,
    invoiceNo,
    amount,
    quantity,
    returnDate,
    createdAt
  };
};

export const loadLocalReturns = (storeId?: string): ReturnRecord[] => {
  if (typeof window === 'undefined' || !storeId) return [];
  try {
    const raw = window.localStorage.getItem(RETURN_LOCAL_KEY(storeId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item, index) => normalizeRecord(item, index))
      .filter((item): item is ReturnRecord => !!item)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 2000);
  } catch {
    return [];
  }
};

export const saveLocalReturns = (storeId: string, records: ReturnRecord[]) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RETURN_LOCAL_KEY(storeId), JSON.stringify(records.slice(0, 2000)));
  } catch {}
};

export const loadMergedReturns = async (storeId?: string): Promise<ReturnRecord[]> => {
  if (!storeId) return [];

  const local = loadLocalReturns(storeId);

  const { data, error } = await supabase
    .from('returns')
    .select('id, product_model, invoice_no, amount, quantity, return_date, created_at')
    .eq('store_id', storeId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(2000);

  if (error) return local;

  const remote = (data || [])
    .map((item, index) => normalizeRecord(item, index))
    .filter((item): item is ReturnRecord => !!item);

  const merged = [...remote, ...local].reduce((acc, item) => {
    const key = `${item.invoiceNo}|${item.productModel}|${item.returnDate}|${item.amount}|${item.quantity}`;
    if (!acc.some(existing => `${existing.invoiceNo}|${existing.productModel}|${existing.returnDate}|${existing.amount}|${existing.quantity}` === key)) {
      acc.push(item);
    }
    return acc;
  }, [] as ReturnRecord[]);

  return merged
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
