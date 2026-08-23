import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const AuthContext = createContext(null);

const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
const SESSION_KEEPALIVE_MS = 5 * 60 * 1000; // refresh while user is active
const ACTIVITY_WRITE_THROTTLE_MS = 15 * 1000;
const LAST_ACTIVITY_STORAGE_KEY = 'aryaman:last_user_activity_at';

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const lastActivityRef = useRef(Date.now());
  const lastActivityWriteRef = useRef(0);
  const lastSessionRefreshRef = useRef(0);

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null);
      return null;
    }

    const { data, error: profErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (profErr) {
      setError(profErr.message);
      setProfile(null);
      return null;
    }

    setProfile(data || null);
    return data || null;
  }, []);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      await loadProfile(data.session?.user?.id);
      if (mounted) setLoading(false);
    }

    bootstrap();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      await loadProfile(newSession?.user?.id);
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email, password) => {
    setError(null);
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr) {
      setError(signInErr.message);
      return { ok: false, error: signInErr.message };
    }
    return { ok: true };
  }, []);

  const signOut = useCallback(async () => {
    try {
      if (typeof window !== 'undefined') window.localStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);
    } catch { /* ignore storage errors */ }
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return undefined;
    let mounted = true;

    const readStoredActivity = () => {
      try {
        const raw = window.localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
        const parsed = Number(raw || 0);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : lastActivityRef.current;
      } catch {
        return lastActivityRef.current;
      }
    };

    const writeActivity = (now) => {
      lastActivityRef.current = now;
      if (now - lastActivityWriteRef.current < ACTIVITY_WRITE_THROTTLE_MS) return;
      lastActivityWriteRef.current = now;
      try { window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(now)); } catch { /* ignore storage errors */ }
    };

    const refreshSessionIfNeeded = async (force = false) => {
      if (!mounted) return;
      const now = Date.now();
      const lastActivity = Math.max(lastActivityRef.current, readStoredActivity());
      if (now - lastActivity >= IDLE_TIMEOUT_MS) {
        await signOut();
        return;
      }
      if (!force && now - lastSessionRefreshRef.current < SESSION_KEEPALIVE_MS) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      lastSessionRefreshRef.current = now;
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        // Network hiccups should not kick an active user out. Only sign out if the
        // local session is gone and the browser is online.
        const { data } = await supabase.auth.getSession();
        if (!data?.session && (typeof navigator === 'undefined' || navigator.onLine)) await signOut();
      }
    };

    const markActivity = () => {
      writeActivity(Date.now());
      refreshSessionIfNeeded(false);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        writeActivity(Date.now());
        refreshSessionIfNeeded(true);
      }
    };

    const handleStorage = (event) => {
      if (event.key !== LAST_ACTIVITY_STORAGE_KEY || !event.newValue) return;
      const parsed = Number(event.newValue);
      if (Number.isFinite(parsed) && parsed > lastActivityRef.current) lastActivityRef.current = parsed;
    };

    writeActivity(Date.now());
    refreshSessionIfNeeded(true);

    const activityEvents = ['click', 'keydown', 'mousemove', 'mousedown', 'touchstart', 'scroll', 'focus'];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, markActivity, { passive: true }));
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('storage', handleStorage);

    const timer = window.setInterval(() => {
      const now = Date.now();
      const lastActivity = Math.max(lastActivityRef.current, readStoredActivity());
      if (now - lastActivity >= IDLE_TIMEOUT_MS) {
        signOut();
        return;
      }
      refreshSessionIfNeeded(false);
    }, 60 * 1000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, markActivity));
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('storage', handleStorage);
    };
  }, [session?.user?.id, signOut]);

  const hasRole = useCallback(
    (...roles) => { const allowed = roles.flat(); const userRoles = [profile?.role, ...(profile?.additional_roles || [])].filter(Boolean); return !!profile && profile.is_active && userRoles.some((r) => allowed.includes(r)); },
    [profile]
  );

  const value = useMemo(() => ({
    user: session?.user || null,
    session,
    profile,
    role: profile?.role || null,
    isActive: profile?.is_active ?? false,
    loading,
    error,
    signIn,
    signOut,
    hasRole,
    reloadProfile: () => loadProfile(session?.user?.id),
  }), [session, profile, loading, error, signIn, signOut, hasRole, loadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider.');
  return ctx;
}

export function RequireRole({ roles, fallback = null, children }) {
  const { hasRole, loading } = useAuth();
  if (loading) return null;
  return hasRole(roles) ? children : fallback;
}
