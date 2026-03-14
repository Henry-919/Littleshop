import { appendStoreActivity, listStoreActivity, type StoreActivityType } from './storeActivity';

export type InboundLogSource = 'manual_add' | 'excel_import' | 'batch_restock' | 'return';

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

const MAX_LOG_COUNT = 2000;
const RECORD_TYPE: StoreActivityType = 'inbound_log';

const normalizeRecord = (payload: any, fallback: { id: string; sortTime: string; storeId: string }): InboundLogRecord | null => {
  if (!payload || typeof payload !== 'object') return null;

  const source = String(payload.source || '') as InboundLogSource;
  if (!['manual_add', 'excel_import', 'batch_restock', 'return'].includes(source)) return null;

  const productName = String(payload.productName || '').trim();
  const qty = Number(payload.qty || 0);
  const storeId = String(payload.storeId || fallback.storeId || '').trim();
  const time = String(payload.time || fallback.sortTime || '').trim();

  if (!productName || !storeId || !Number.isFinite(qty) || qty <= 0 || !time) return null;

  return {
    id: String(payload.id || fallback.id),
    time,
    storeId,
    source,
    productName,
    qty,
    note: payload.note ? String(payload.note) : undefined,
  };
};

export const appendInboundLogs = async (entries: AppendInboundLogInput[]) => {
  if (!entries?.length) return true;

  const normalizedEntries = entries
    .map((entry) => {
      const storeId = String(entry.storeId || '').trim();
      const productName = String(entry.productName || '').trim();
      const qty = Number(entry.qty || 0);
      if (!storeId || !productName || !Number.isFinite(qty) || qty <= 0) return null;

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const time = entry.time || new Date().toISOString();
      const payload = normalizeRecord(
        {
          id,
          time,
          storeId,
          source: entry.source,
          productName,
          qty,
          note: entry.note,
        },
        { id, sortTime: time, storeId }
      );

      if (!payload) return null;

      return {
        id: payload.id,
        sortTime: payload.time,
        payload,
        storeId: payload.storeId,
      };
    })
    .filter((item): item is { id: string; sortTime: string; payload: InboundLogRecord; storeId: string } => !!item);

  if (!normalizedEntries.length) return true;

  const grouped = normalizedEntries.reduce((acc, item) => {
    const list = acc.get(item.storeId) || [];
    list.push({ id: item.id, sortTime: item.sortTime, payload: item.payload });
    acc.set(item.storeId, list);
    return acc;
  }, new Map<string, Array<{ id: string; sortTime: string; payload: InboundLogRecord }>>());

  const results = await Promise.all(
    Array.from(grouped.entries()).map(([storeId, records]) => appendStoreActivity(storeId, RECORD_TYPE, records))
  );

  return results.every(Boolean);
};

export const getInboundLogsByStore = async (storeId?: string) => {
  return listStoreActivity<InboundLogRecord>(storeId, RECORD_TYPE, MAX_LOG_COUNT, (row) =>
    normalizeRecord(row.payload, {
      id: row.id,
      sortTime: row.sort_time || row.created_at || new Date().toISOString(),
      storeId: row.store_id,
    })
  );
};
