import { supabase } from './supabase';

export type StoreActivityType =
  | 'pos_entry'
  | 'receipt_recognition'
  | 'stock_batch_history'
  | 'inbound_log';

type StoreActivityRow = {
  id: string;
  store_id: string;
  record_type: StoreActivityType;
  sort_time: string;
  payload: unknown;
  created_at: string;
};

type AppendStoreActivityInput<T> = {
  id?: string;
  sortTime?: string;
  payload: T;
};

const STORE_ACTIVITY_TABLE = 'store_activity_records';
const STORE_ACTIVITY_LOCAL_PREFIX = 'littleshop_store_activity_records';

const isMissingTableError = (error: unknown) => {
  const code = String((error as { code?: string } | null)?.code || '').toUpperCase();
  return code === '42P01' || code === 'PGRST205';
};

const getLocalKey = (storeId: string, recordType: StoreActivityType) =>
  `${STORE_ACTIVITY_LOCAL_PREFIX}:${storeId}:${recordType}`;

const readLocalRows = (storeId: string, recordType: StoreActivityType): StoreActivityRow[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(getLocalKey(storeId, recordType));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        id: String(item.id || ''),
        store_id: String(item.store_id || storeId),
        record_type: recordType,
        sort_time: String(item.sort_time || item.created_at || new Date().toISOString()),
        payload: item.payload,
        created_at: String(item.created_at || item.sort_time || new Date().toISOString()),
      }))
      .filter((item) => !!item.id);
  } catch {
    return [];
  }
};

const writeLocalRows = (storeId: string, recordType: StoreActivityType, rows: StoreActivityRow[]) => {
  if (typeof window === 'undefined') return;
  try {
    if (!rows.length) {
      window.localStorage.removeItem(getLocalKey(storeId, recordType));
      return;
    }
    window.localStorage.setItem(getLocalKey(storeId, recordType), JSON.stringify(rows));
  } catch {
    // ignore local cache write failures
  }
};

export async function listStoreActivity<T>(
  storeId: string | undefined,
  recordType: StoreActivityType,
  limit: number,
  normalize: (row: StoreActivityRow, index: number) => T | null
): Promise<T[]> {
  const currentStoreId = String(storeId || '').trim();
  if (!currentStoreId) return [];
  const localRows = readLocalRows(currentStoreId, recordType);

  const { data, error } = await supabase
    .from(STORE_ACTIVITY_TABLE)
    .select('id, store_id, record_type, sort_time, payload, created_at')
    .eq('store_id', currentStoreId)
    .eq('record_type', recordType)
    .is('deleted_at', null)
    .order('sort_time', { ascending: false })
    .limit(limit);

  if (error) {
    if (!isMissingTableError(error)) {
      console.error(`Failed to load ${recordType} activity:`, error);
    }
    return localRows
      .map((row, index) => normalize(row, index))
      .filter((item): item is T => !!item);
  }

  const mergedRows = [...(data as StoreActivityRow[] || []), ...localRows].reduce((acc, row) => {
    if (!acc.some((item) => item.id === row.id)) {
      acc.push(row);
    }
    return acc;
  }, [] as StoreActivityRow[]);

  return mergedRows
    .sort((a, b) => new Date(b.sort_time || b.created_at).getTime() - new Date(a.sort_time || a.created_at).getTime())
    .map((row, index) => normalize(row, index))
    .filter((item): item is T => !!item);
}

export async function appendStoreActivity<T>(
  storeId: string | undefined,
  recordType: StoreActivityType,
  records: AppendStoreActivityInput<T>[]
): Promise<boolean> {
  const currentStoreId = String(storeId || '').trim();
  if (!currentStoreId || !records.length) return true;

  const rows = records.map((record) => ({
    id: record.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    store_id: currentStoreId,
    record_type: recordType,
    sort_time: record.sortTime || new Date().toISOString(),
    payload: record.payload,
    created_at: record.sortTime || new Date().toISOString(),
  }));

  const { error } = await supabase.from(STORE_ACTIVITY_TABLE).insert(rows);
  if (error) {
    if (!isMissingTableError(error)) {
      console.error(`Failed to append ${recordType} activity:`, error);
    }
    const existing = readLocalRows(currentStoreId, recordType);
    const merged = [...rows, ...existing].reduce((acc, row) => {
      if (!acc.some((item) => item.id === row.id)) {
        acc.push(row);
      }
      return acc;
    }, [] as StoreActivityRow[]);
    writeLocalRows(currentStoreId, recordType, merged);
    return false;
  }

  const existing = readLocalRows(currentStoreId, recordType);
  if (existing.length > 0) {
    const next = existing.filter((item) => !rows.some((row) => row.id === item.id));
    writeLocalRows(currentStoreId, recordType, next);
  }

  return true;
}

export async function clearStoreActivity(
  storeId: string | undefined,
  recordType: StoreActivityType
): Promise<boolean> {
  const currentStoreId = String(storeId || '').trim();
  if (!currentStoreId) return true;
  writeLocalRows(currentStoreId, recordType, []);

  const { error } = await supabase
    .from(STORE_ACTIVITY_TABLE)
    .update({ deleted_at: new Date().toISOString() })
    .eq('store_id', currentStoreId)
    .eq('record_type', recordType)
    .is('deleted_at', null);

  if (error) {
    if (!isMissingTableError(error)) {
      console.error(`Failed to clear ${recordType} activity:`, error);
    }
    return false;
  }

  return true;
}
