import React, { useState } from "react";
import { AuthProvider, useAuth, RequireRole } from "./auth/AuthProvider";
import LoginPage from "./auth/LoginPage";
import RnDModule from "./modules/rnd/RnDModule";
// وقتی ماژول‌های بعدی ساخته شدند، همین‌جا اضافه می‌شوند:
// import OrdersModule from "./modules/orders/OrdersModule";
// import WarehouseModule from "./modules/warehouse/WarehouseModule";
// import AccountingModule from "./modules/accounting/AccountingModule";

function AppShell() {
  const { user, profile, loading, signOut } = useAuth();
  const [activeModule, setActiveModule] = useState("rnd");

  if (loading) return <div style={{ padding: 40, fontFamily: "sans-serif" }}>در حال بارگذاری...</div>;
  if (!user) return <LoginPage />;

  // پروفایل هنوز از دیتابیس نیامده یا کاربر غیرفعال شده
  if (!profile || !profile.is_active) {
    return (
      <div style={{ padding: 40, fontFamily: "sans-serif" }}>
        دسترسی این حساب فعال نیست. با مدیر سیستم تماس بگیرید.
        <button onClick={signOut} style={{ display: "block", marginTop: 12 }}>خروج</button>
      </div>
    );
  }

  const modules = [
    { key: "rnd", label: "R&D", roles: ["admin", "rnd_manager", "sales", "accountant"], Component: RnDModule },
    // { key: "orders", label: "سفارش", roles: ["admin", "sales", "production_manager"], Component: OrdersModule },
    // { key: "warehouse", label: "انبار", roles: ["admin", "warehouse"], Component: WarehouseModule },
    // { key: "accounting", label: "حسابداری", roles: ["admin", "accountant"], Component: AccountingModule },
  ];

  const visibleModules = modules.filter((m) => m.roles.includes(profile.role));
  const current = visibleModules.find((m) => m.key === activeModule) || visibleModules[0];

  return (
    <div>
      <nav style={{ display: "flex", gap: 8, padding: 12, background: "#14181C" }}>
        {visibleModules.map((m) => (
          <button
            key={m.key}
            onClick={() => setActiveModule(m.key)}
            style={{
              padding: "8px 14px", borderRadius: 8, border: "none", cursor: "pointer",
              background: current?.key === m.key ? "#A8672E" : "transparent",
              color: "#fff", fontSize: 13, fontFamily: "inherit",
            }}
          >
            {m.label}
          </button>
        ))}
        <div style={{ marginInlineStart: "auto", color: "#9BA6AF", fontSize: 13, display: "flex", alignItems: "center", gap: 10 }}>
          {profile.full_name} · {profile.role}
          <button onClick={signOut} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer" }}>خروج</button>
        </div>
      </nav>
      {current ? <current.Component /> : <div style={{ padding: 40 }}>هیچ ماژولی برای نقش شما فعال نیست.</div>}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
