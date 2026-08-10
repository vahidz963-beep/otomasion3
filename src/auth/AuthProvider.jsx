import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
  }, []);

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
