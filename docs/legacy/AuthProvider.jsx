import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    const { data, error: profErr } = await supabase
      .from("profiles")
      .select("id, full_name, full_name_en, role, is_active")
      .eq("id", userId)
      .single();

    if (profErr) {
      setError(profErr.message);
      setProfile(null);
      return;
    }
    setProfile(data);
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      await loadProfile(data.session?.user?.id);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      await loadProfile(newSession?.user?.id);
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

  // بررسی نقش در سمت فرانت‌اند (فقط برای نمایش/مخفی کردن UI — امنیت واقعی روی RLS دیتابیس است)
  const hasRole = useCallback(
    (...roles) => !!profile && profile.is_active && roles.flat().includes(profile.role),
    [profile]
  );

  const value = {
    user: session?.user || null,
    profile,
    role: profile?.role || null,
    isActive: profile?.is_active ?? false,
    loading,
    error,
    signIn,
    signOut,
    hasRole,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth باید داخل AuthProvider استفاده شود.");
  return ctx;
}

/**
 * گیت کردن بخشی از UI بر اساس نقش — معادل فرانت‌اندی همان has_role() سمت دیتابیس.
 * <RequireRole roles={["admin", "rnd_manager"]}>...</RequireRole>
 */
export function RequireRole({ roles, fallback = null, children }) {
  const { hasRole, loading } = useAuth();
  if (loading) return null;
  return hasRole(roles) ? children : fallback;
}
