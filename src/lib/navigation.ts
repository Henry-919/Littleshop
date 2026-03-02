import type { TabType } from '../components/Sidebar';

const NAVIGATE_EVENT = 'littleshop:navigate';
const SALES_HISTORY_JUMP_KEY = 'littleshop_sales_history_jump_v1';

export type NavigatePayload = {
  tab: TabType;
};

export type SalesHistoryJumpPayload = {
  storeId?: string;
  keyword?: string;
  salesperson?: string;
  date?: string;
  saleId?: string;
  createdAt: string;
};

export const emitNavigate = (payload: NavigatePayload) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: payload }));
};

export const subscribeNavigate = (handler: (payload: NavigatePayload) => void) => {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<NavigatePayload>).detail;
    if (!detail?.tab) return;
    handler(detail);
  };
  window.addEventListener(NAVIGATE_EVENT, listener as EventListener);
  return () => window.removeEventListener(NAVIGATE_EVENT, listener as EventListener);
};

export const setSalesHistoryJumpPayload = (payload: Omit<SalesHistoryJumpPayload, 'createdAt'>) => {
  if (typeof window === 'undefined') return;
  const fullPayload: SalesHistoryJumpPayload = {
    ...payload,
    createdAt: new Date().toISOString()
  };
  window.localStorage.setItem(SALES_HISTORY_JUMP_KEY, JSON.stringify(fullPayload));
};

export const consumeSalesHistoryJumpPayload = (): SalesHistoryJumpPayload | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SALES_HISTORY_JUMP_KEY);
    if (!raw) return null;
    window.localStorage.removeItem(SALES_HISTORY_JUMP_KEY);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      storeId: parsed.storeId ? String(parsed.storeId) : undefined,
      keyword: parsed.keyword ? String(parsed.keyword) : undefined,
      salesperson: parsed.salesperson ? String(parsed.salesperson) : undefined,
      date: parsed.date ? String(parsed.date) : undefined,
      saleId: parsed.saleId ? String(parsed.saleId) : undefined,
      createdAt: parsed.createdAt ? String(parsed.createdAt) : new Date().toISOString()
    };
  } catch {
    return null;
  }
};
