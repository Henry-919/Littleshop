import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables are missing. Please check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}

let writeAccessEnabled = false;

const permissionError = () => ({
  data: null,
  error: {
    message: 'permission_denied',
    code: 'permission_denied',
  },
  count: null,
  status: 403,
  statusText: 'Forbidden',
});

const rawClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder'
);

const withWriteGuard = (builder: any) => {
  if (!builder || typeof builder !== 'object') return builder;

  for (const method of ['insert', 'update', 'upsert', 'delete']) {
    if (typeof builder[method] !== 'function') continue;
    const original = builder[method].bind(builder);
    builder[method] = (...args: any[]) => {
      if (!writeAccessEnabled) {
        return Promise.resolve(permissionError());
      }
      return original(...args);
    };
  }

  return builder;
};

export const supabase = new Proxy(rawClient as any, {
  get(target, prop, receiver) {
    if (prop === 'from') {
      return (table: string) => withWriteGuard(target.from(table));
    }
    if (prop === 'rpc') {
      return (fn: string, args?: Record<string, any>, options?: Record<string, any>) => {
        if (!writeAccessEnabled) {
          return Promise.resolve(permissionError());
        }
        return target.rpc(fn, args, options);
      };
    }
    return Reflect.get(target, prop, receiver);
  },
});

export const setSupabaseWriteAccess = (enabled: boolean) => {
  writeAccessEnabled = enabled;
};
