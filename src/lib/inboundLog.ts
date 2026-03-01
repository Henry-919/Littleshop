export type InboundLogSource = 'manual_add' | 'excel_import' | 'batch_restock';

export type InboundLogRecord = {
  id: string;
  time: string;
  storeId: string;
  source: InboundLogSource;
  productName: string;
  qty: number;
  note?: string;
};

type AppendInboundLogInput = {
  storeId?: string;
  source: InboundLogSource;
  productName: string;
  qty: number;
  note?: string;
  time?: string;
};

const INBOUND_LOG_KEY = 'littleshop_inbound_log_v1';
const MAX_LOG_COUNT = 2000;

const toArray = (value: unknown): any[] => {
  if (!Array.isArray(value)) return [];
  return value;
};

const normalizeRecord = (item: any): InboundLogRecord | null => {
  if (!item || typeof item !== 'object') return null;

  const source = String(item.source || '') as InboundLogSource;
  if (!['manual_add', 'excel_import', 'batch_restock'].includes(source)) return null;

  const productName = String(item.productName || '').trim();
  const qty = Number(item.qty || 0);
  const storeId = String(item.storeId || '').trim();
  const time = String(item.time || '').trim();

  if (!productName || !storeId || !Number.isFinite(qty) || qty <= 0 || !time) return null;

  return {
    id: String(item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    time,
    storeId,
    source,
    productName,
    qty,
    note: item.note ? String(item.note) : undefined
  };
};

const readAllRecords = (): InboundLogRecord[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(INBOUND_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return toArray(parsed)
      .map(normalizeRecord)
      .filter((item): item is InboundLogRecord => !!item)
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, MAX_LOG_COUNT);
  } catch {
    return [];
  }
};

const saveAllRecords = (records: InboundLogRecord[]) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(INBOUND_LOG_KEY, JSON.stringify(records.slice(0, MAX_LOG_COUNT)));
  } catch {}
};

export const appendInboundLogs = (entries: AppendInboundLogInput[]) => {
  if (!entries?.length) return;

  const normalizedEntries = entries
    .map((entry) => {
      const storeId = String(entry.storeId || '').trim();
      const productName = String(entry.productName || '').trim();
      const qty = Number(entry.qty || 0);
      if (!storeId || !productName || !Number.isFinite(qty) || qty <= 0) return null;

      return normalizeRecord({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        time: entry.time || new Date().toISOString(),
        storeId,
        source: entry.source,
        productName,
        qty,
        note: entry.note
      });
    })
    .filter((item): item is InboundLogRecord => !!item);

  if (!normalizedEntries.length) return;

  const existing = readAllRecords();
  const merged = [...normalizedEntries, ...existing]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, MAX_LOG_COUNT);

  saveAllRecords(merged);
};

export const getInboundLogsByStore = (storeId?: string) => {
  const currentStoreId = String(storeId || '').trim();
  if (!currentStoreId) return [] as InboundLogRecord[];
  return readAllRecords().filter((item) => item.storeId === currentStoreId);
};
