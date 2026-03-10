import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, setSupabaseWriteAccess } from '../lib/supabase';

export type AppRole = 'admin' | 'viewer';

type AuthContextValue = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  role: AppRole;
  canEdit: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const AUTH_CACHE_KEY = 'littleshop_auth_cache_v1';

const getAdminEmails = () =>
  String(import.meta.env.VITE_ADMIN_EMAILS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const roleFromUserMetadata = (user: User | null): AppRole | null => {
  const candidates = [
    user?.app_metadata?.role,
    user?.user_metadata?.role,
    user?.app_metadata?.app_role,
    user?.user_metadata?.app_role,
  ];

  for (const value of candidates) {
    if (value === 'admin' || value === 'viewer') return value;
  }

  return null;
};

const readCachedAuth = (): { session: Session | null; role: AppRole; loading: boolean } => {
  if (typeof window === 'undefined') {
    return { session: null, role: 'viewer', loading: true };
  }

  try {
    const raw = window.localStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) {
      return { session: null, role: 'viewer', loading: true };
    }

    const parsed = JSON.parse(raw) as { session?: Session | null; role?: AppRole };
    const session = parsed?.session ?? null;
    const expiresAt = Number(session?.expires_at || 0);
    if (!session?.user || (expiresAt > 0 && expiresAt * 1000 <= Date.now())) {
      window.localStorage.removeItem(AUTH_CACHE_KEY);
      return { session: null, role: 'viewer', loading: true };
    }

    const role = parsed?.role === 'admin' ? 'admin' : 'viewer';
    return { session, role, loading: false };
  } catch {
    return { session: null, role: 'viewer', loading: true };
  }
};

const writeCachedAuth = (session: Session | null, role: AppRole) => {
  if (typeof window === 'undefined') return;

  if (!session?.user) {
    window.localStorage.removeItem(AUTH_CACHE_KEY);
    return;
  }

  window.localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({ session, role }));
};

async function resolveRole(user: User | null): Promise<AppRole> {
  if (!user) return 'viewer';

  const metadataRole = roleFromUserMetadata(user);
  if (metadataRole) return metadataRole;

  const email = String(user.email || '').trim().toLowerCase();
  if (email && getAdminEmails().includes(email)) {
    return 'admin';
  }

  const attempts: Array<{ table: string; filters: Record<string, string> }> = [
    { table: 'profiles', filters: { id: user.id } },
    { table: 'profiles', filters: { user_id: user.id } },
    { table: 'user_profiles', filters: { id: user.id } },
    { table: 'user_profiles', filters: { user_id: user.id } },
    { table: 'user_roles', filters: { user_id: user.id } },
    ...(email ? [{ table: 'user_roles', filters: { email } }] : []),
  ];

  for (const attempt of attempts) {
    let query = supabase.from(attempt.table).select('role').limit(1);
    for (const [column, value] of Object.entries(attempt.filters)) {
      query = query.eq(column, value);
    }

    const { data, error } = await query.maybeSingle();
    if (error) continue;

    if (data?.role === 'admin' || data?.role === 'viewer') {
      return data.role;
    }
  }

  return 'viewer';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const initialAuth = readCachedAuth();
  const [loading, setLoading] = useState(initialAuth.loading);
  const [session, setSession] = useState<Session | null>(initialAuth.session);
  const [role, setRole] = useState<AppRole>(initialAuth.role);

  useEffect(() => {
    setSupabaseWriteAccess(initialAuth.role === 'admin');
  }, []);

  useEffect(() => {
    let alive = true;

    const syncSession = async (nextSession: Session | null, options?: { keepVisible?: boolean }) => {
      if (!alive) return;
      setSession(nextSession);

      if (!nextSession?.user) {
        setRole('viewer');
        setSupabaseWriteAccess(false);
        writeCachedAuth(null, 'viewer');
        setLoading(false);
        return;
      }

      if (!options?.keepVisible) {
        setLoading(true);
      }
      const nextRole = await resolveRole(nextSession.user);
      if (!alive) return;
      setRole(nextRole);
      setSupabaseWriteAccess(nextRole === 'admin');
      writeCachedAuth(nextSession, nextRole);
      setLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => {
      void syncSession(data.session, { keepVisible: true });
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void syncSession(nextSession, { keepVisible: true });
    });

    return () => {
      alive = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return {};
  };

  const signOut = async () => {
    writeCachedAuth(null, 'viewer');
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        loading,
        session,
        user: session?.user ?? null,
        role,
        canEdit: role === 'admin',
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
