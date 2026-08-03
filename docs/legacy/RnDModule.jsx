import React, { useState, useMemo } from "react";
import {
  Plus, X, FileText, MessageSquare, Clock, Flag, Calendar,
  LayoutGrid, List as ListIcon, Cpu, Factory, CheckCircle2,
  ChevronDown, Paperclip, DollarSign, Globe, Search, Upload,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Tokens                                                             */
/* ------------------------------------------------------------------ */

const C = {
  graphite900: "#14181C",
  graphite800: "#1E252B",
  graphiteLine: "#2B333A",
  paper: "#F3F5F6",
  paperDim: "#E7EAEC",
  ink: "#1B2126",
  inkDim: "#5B6670",
  steel: "#3B4B5C",
  steelLight: "#7690A3",
  copper: "#A8672E",
  copperLight: "#E7C39C",
  amber: "#B98A2E",
  amberLight: "#F1DBA8",
  green: "#4C7A61",
  greenLight: "#BFDACB",
  red: "#A5453F",
  redLight: "#EFC7C3",
  gray: "#8891998",
};

const OUTPUT_TYPES = {
  transformer_sample: { fa: "نمونه ترانس", en: "Transformer sample", color: C.steel, icon: Cpu },
  pcb_sample: { fa: "نمونه برد", en: "PCB sample", color: C.copper, icon: Cpu },
  pcb_design_service: { fa: "خدمات طراحی PCB", en: "PCB design service", color: C.amber, icon: FileText },
  technical_service: { fa: "خدمات فنی", en: "Technical service", color: C.green, icon: Factory },
};

const STATUSES = [
  { key: "requested", fa: "درخواست شده", en: "Requested", color: C.inkDim },
  { key: "feasibility_review", fa: "امکان‌سنجی", en: "Feasibility review", color: C.steelLight },
  { key: "in_progress", fa: "در حال طراحی", en: "In progress", color: C.copper },
  { key: "prototyping", fa: "نمونه‌سازی", en: "Prototyping", color: C.copper },
  { key: "testing", fa: "تست", en: "Testing", color: C.amber },
  { key: "ready_for_delivery", fa: "آماده تحویل", en: "Ready for delivery", color: C.green },
  { key: "delivered", fa: "تحویل شده", en: "Delivered", color: C.green },
  { key: "transferred_to_production", fa: "منتقل به تولید", en: "Sent to production", color: C.steel },
  { key: "closed", fa: "بسته شده", en: "Closed", color: C.inkDim },
  { key: "cancelled", fa: "لغو شده", en: "Cancelled", color: C.red },
];

const statusOf = (k) => STATUSES.find((s) => s.key === k);

const T = {
  title: { fa: "بخش R&D", en: "R&D Module" },
  subtitle: { fa: "پیگیری پروژه‌ها از درخواست تا تحویل یا تولید", en: "Track projects from request to delivery or production" },
  newProject: { fa: "پروژه جدید", en: "New project" },
  kanban: { fa: "کانبان", en: "Kanban" },
  list: { fa: "لیست", en: "List" },
  search: { fa: "جست‌وجوی عنوان یا کد...", en: "Search title or code..." },
  code: { fa: "کد", en: "Code" },
  order: { fa: "سفارش", en: "Order" },
  assignee: { fa: "مسئول", en: "Assignee" },
  due: { fa: "موعد", en: "Due" },
  status: { fa: "وضعیت", en: "Status" },
  outputType: { fa: "نوع خروجی", en: "Output type" },
  overdue: { fa: "عقب‌افتاده", en: "Overdue" },
  noProjects: { fa: "پروژه‌ای در این وضعیت نیست", en: "No projects in this status" },
  detailTabs: { timeline: { fa: "تایم‌لاین", en: "Timeline" }, files: { fa: "فایل‌ها", en: "Files" }, comments: { fa: "یادداشت‌ها", en: "Comments" }, cost: { fa: "هزینه‌ها", en: "Costs" } },
  estCost: { fa: "برآورد هزینه", en: "Estimated cost" },
  actCost: { fa: "هزینه واقعی", en: "Actual cost" },
  changeStatus: { fa: "تغییر وضعیت به:", en: "Change status to:" },
  addNote: { fa: "یادداشت بگذارید...", en: "Write a note..." },
  send: { fa: "ارسال", en: "Send" },
  uploadFile: { fa: "افزودن فایل", en: "Add file" },
  noFiles: { fa: "هنوز فایلی پیوست نشده.", en: "No files attached yet." },
  noComments: { fa: "هنوز یادداشتی ثبت نشده.", en: "No comments yet." },
  addCost: { fa: "افزودن قلم هزینه", en: "Add cost item" },
  desc: { fa: "شرح", en: "Description" },
  amount: { fa: "مبلغ (تومان)", en: "Amount" },
  add: { fa: "افزودن", en: "Add" },
  close: { fa: "بستن", en: "Close" },
  form: {
    heading: { fa: "ثبت پروژه R&D جدید", en: "New R&D Project" },
    titleFa: { fa: "عنوان (فارسی)", en: "Title (Persian)" },
    titleEn: { fa: "عنوان (انگلیسی)", en: "Title (English)" },
    orderCode: { fa: "کد سفارش (اختیاری)", en: "Order code (optional)" },
    priority: { fa: "اولویت", en: "Priority" },
    priorityOpts: [{ v: 1, fa: "فوری", en: "Urgent" }, { v: 2, fa: "عادی", en: "Normal" }, { v: 3, fa: "کم‌اهمیت", en: "Low" }],
    description: { fa: "توضیحات فنی", en: "Technical description" },
    submit: { fa: "ثبت پروژه", en: "Create project" },
    cancel: { fa: "انصراف", en: "Cancel" },
  },
  productionBanner: {
    fa: "این پروژه به تولید داخلی منتقل شده است.",
    en: "This project has been transferred to internal production.",
  },
};

/* ------------------------------------------------------------------ */
/*  Mock seed data (matches the Supabase schema fields)                */
/* ------------------------------------------------------------------ */

const seedProjects = [
  {
    id: "1", code: "RND-202607-0001",
    title_fa: "نمونه ترانس ۲۲۰ به ۱۲ ولت سفارشی",
    title_en: "Custom 220-12V transformer sample",
    output_type: "transformer_sample", status: "in_progress",
    order_code: "ORD-1042", assigned: "علیرضا کریمی", priority: 2,
    estimated_cost: 3200000, actual_cost: 1450000, due_date: "2026-08-05",
    description_fa: "طراحی هسته و سیم‌پیچی برای مصرف‌کننده صنعتی با محدودیت دما.",
  },
  {
    id: "2", code: "RND-202607-0002",
    title_fa: "برد کنترلر دور موتور - نمونه اول",
    title_en: "Motor speed controller board - first sample",
    output_type: "pcb_sample", status: "testing",
    order_code: "ORD-1050", assigned: "سارا محمدی", priority: 1,
    estimated_cost: 5400000, actual_cost: 5100000, due_date: "2026-07-30",
    description_fa: "تست حرارتی و EMC روی نمونه اول قبل از تحویل.",
  },
  {
    id: "3", code: "RND-202607-0003",
    title_fa: "خدمات طراحی PCB برای مشتری خارجی",
    title_en: "PCB design service for external client",
    output_type: "pcb_design_service", status: "ready_for_delivery",
    order_code: null, assigned: "علیرضا کریمی", priority: 2,
    estimated_cost: 2100000, actual_cost: 2050000, due_date: "2026-07-25",
    description_fa: "طراحی شماتیک و لایه‌گذاری چهار لایه، بدون نیاز به نمونه‌سازی داخلی.",
  },
  {
    id: "4", code: "RND-202606-0014",
    title_fa: "خدمات فنی - عیب‌یابی مدار حفاظتی",
    title_en: "Technical service - protection circuit diagnostics",
    output_type: "technical_service", status: "delivered",
    order_code: "ORD-0988", assigned: "نگار احمدی", priority: 3,
    estimated_cost: 800000, actual_cost: 750000, due_date: "2026-07-10",
    description_fa: "بررسی و رفع خطای قطع ناگهانی مدار حفاظتی مشتری.",
  },
  {
    id: "5", code: "RND-202606-0011",
    title_fa: "نمونه ترانس فرکانس بالا",
    title_en: "High-frequency transformer sample",
    output_type: "transformer_sample", status: "transferred_to_production",
    order_code: "ORD-0960", assigned: "علیرضا کریمی", priority: 2,
    estimated_cost: 4000000, actual_cost: 3900000, due_date: "2026-06-28",
    description_fa: "نمونه تایید شد و به خط تولید داخلی سپرده شد.",
    went_to_production: true, production_order_id: "PRD-2207",
  },
  {
    id: "6", code: "RND-202607-0004",
    title_fa: "امکان‌سنجی نمونه برد شارژر سریع",
    title_en: "Feasibility - fast charger board sample",
    output_type: "pcb_sample", status: "feasibility_review",
    order_code: "ORD-1061", assigned: "سارا محمدی", priority: 2,
    estimated_cost: null, actual_cost: 0, due_date: "2026-08-12",
    description_fa: "بررسی امکان ساخت با قطعات موجود در انبار.",
  },
  {
    id: "7", code: "RND-202607-0005",
    title_fa: "درخواست نمونه ترانس ایزوله پزشکی",
    title_en: "Request for isolated medical-grade transformer sample",
    output_type: "transformer_sample", status: "requested",
    order_code: null, assigned: null, priority: 1,
    estimated_cost: null, actual_cost: 0, due_date: "2026-08-15",
    description_fa: "درخواست اولیه مشتری، هنوز مسئول تعیین نشده.",
  },
];

const seedHistory = {
  "1": [
    { status: "requested", note_fa: "درخواست از طریق سفارش ORD-1042 ثبت شد.", by: "پریسا سلطانی", at: "2026-07-05" },
    { status: "feasibility_review", note_fa: "امکان‌سنجی تایید شد.", by: "علیرضا کریمی", at: "2026-07-08" },
    { status: "in_progress", note_fa: "شروع طراحی سیم‌پیچی.", by: "علیرضا کریمی", at: "2026-07-12" },
  ],
  "5": [
    { status: "requested", note_fa: "درخواست ثبت شد.", by: "پریسا سلطانی", at: "2026-06-01" },
    { status: "in_progress", note_fa: "طراحی آغاز شد.", by: "علیرضا کریمی", at: "2026-06-05" },
    { status: "testing", note_fa: "تست فرکانسی موفق بود.", by: "علیرضا کریمی", at: "2026-06-18" },
    { status: "delivered", note_fa: "نمونه تحویل مدیر تولید شد.", by: "علیرضا کریمی", at: "2026-06-25" },
    { status: "transferred_to_production", note_fa: "پرونده فنی به تولید منتقل شد (PRD-2207).", by: "مدیر کل", at: "2026-06-28" },
  ],
};

const seedDocuments = {
  "1": [{ name: "winding-spec-v2.pdf", by: "علیرضا کریمی", at: "2026-07-12" }],
  "2": [{ name: "schematic-rev-c.sch", by: "سارا محمدی", at: "2026-07-15" }, { name: "thermal-test-report.pdf", by: "سارا محمدی", at: "2026-07-22" }],
};

const seedComments = {
  "2": [{ text: "تست EMC نیاز به تکرار در دمای بالاتر دارد.", by: "سارا محمدی", at: "2026-07-23" }],
};

const seedCosts = {
  "1": [{ desc: "سیم مسی 0.5mm", type: "material", amount: 950000 }, { desc: "ساعت کاری طراحی", type: "labor", amount: 500000 }],
};

const fmtMoney = (n) => (n == null ? "—" : n.toLocaleString("en-US") + " ت");
const isOverdue = (p) => p.due_date && p.due_date < "2026-07-28" && !["delivered", "closed", "cancelled", "transferred_to_production"].includes(p.status);

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function RnDModule() {
  const [lang, setLang] = useState("fa");
  const [view, setView] = useState("kanban");
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState(seedProjects);
  const [history, setHistory] = useState(seedHistory);
  const [documents, setDocuments] = useState(seedDocuments);
  const [comments, setComments] = useState(seedComments);
  const [costs, setCosts] = useState(seedCosts);
  const [selectedId, setSelectedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [detailTab, setDetailTab] = useState("timeline");
  const [toast, setToast] = useState(null);

  const isFa = lang === "fa";
  const dir = isFa ? "rtl" : "ltr";
  const tt = (obj) => (obj ? obj[lang] : "");

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2200); };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) => p.code.toLowerCase().includes(q) || p.title_fa.includes(q) || p.title_en.toLowerCase().includes(q)
    );
  }, [projects, query]);

  const selected = projects.find((p) => p.id === selectedId) || null;

  function createProject(data) {
    const seq = String(projects.length + 1).padStart(4, "0");
    const id = String(Date.now());
    const proj = {
      id, code: `RND-202607-${seq}`,
      title_fa: data.title_fa, title_en: data.title_en || data.title_fa,
      output_type: data.output_type, status: "requested",
      order_code: data.order_code || null, assigned: null, priority: Number(data.priority),
      estimated_cost: data.estimated_cost ? Number(data.estimated_cost) : null, actual_cost: 0,
      due_date: data.due_date || null, description_fa: data.description_fa,
    };
    setProjects((p) => [proj, ...p]);
    setHistory((h) => ({ ...h, [id]: [{ status: "requested", note_fa: "درخواست ثبت شد.", by: isFa ? "شما" : "You", at: "2026-07-28" }] }));
    setShowForm(false);
    flash(isFa ? "پروژه ثبت شد." : "Project created.");
  }

  function changeStatus(id, newStatus) {
    setProjects((ps) => ps.map((p) => (p.id === id ? {
      ...p, status: newStatus,
      went_to_production: newStatus === "transferred_to_production" ? true : p.went_to_production,
      production_order_id: newStatus === "transferred_to_production" ? `PRD-${Math.floor(2000 + Math.random() * 900)}` : p.production_order_id,
    } : p)));
    setHistory((h) => ({ ...h, [id]: [...(h[id] || []), { status: newStatus, note_fa: "وضعیت به‌روزرسانی شد.", by: isFa ? "شما" : "You", at: "2026-07-28" }] }));
    flash(isFa ? "وضعیت تغییر کرد." : "Status updated.");
  }

  function addComment(id, text) {
    if (!text.trim()) return;
    setComments((c) => ({ ...c, [id]: [...(c[id] || []), { text, by: isFa ? "شما" : "You", at: "2026-07-28" }] }));
  }

  function addDocument(id, file) {
    if (!file) return;
    setDocuments((d) => ({ ...d, [id]: [...(d[id] || []), { name: file.name, by: isFa ? "شما" : "You", at: "2026-07-28" }] }));
    flash(isFa ? "فایل پیوست شد." : "File attached.");
  }

  function addCost(id, item) {
    setCosts((c) => ({ ...c, [id]: [...(c[id] || []), item] }));
    setProjects((ps) => ps.map((p) => p.id === id ? { ...p, actual_cost: (p.actual_cost || 0) + item.amount } : p));
  }

  return (
    <div dir={dir} style={{ fontFamily: "'Vazirmatn', sans-serif", background: C.paper, minHeight: "100vh", color: C.ink }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        .mono { font-family: 'IBM Plex Mono', monospace; }
        .rnd-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
        .rnd-scroll::-webkit-scrollbar-thumb { background: ${C.graphiteLine}; border-radius: 8px; }
        .drawer-in { animation: drawerIn .22s ease-out; }
        @keyframes drawerIn { from { transform: translateX(${isFa ? "-16px" : "16px"}); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
        .card:hover { box-shadow: 0 2px 10px rgba(20,24,28,.10); transform: translateY(-1px); }
        .card { transition: box-shadow .15s ease, transform .15s ease; }
      `}</style>

      {/* Top bar */}
      <div style={{ background: C.graphite900, color: "#fff", padding: "18px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Cpu size={20} color={C.copperLight} />
              <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{tt(T.title)}</h1>
            </div>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#9BA6AF" }}>{tt(T.subtitle)}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => setLang(isFa ? "en" : "fa")}
              style={btnGhost}>
              <Globe size={15} /> {isFa ? "EN" : "فا"}
            </button>
            <div style={{ display: "flex", background: C.graphite800, borderRadius: 10, padding: 3 }}>
              <button onClick={() => setView("kanban")} style={toggleBtn(view === "kanban")}><LayoutGrid size={15} /> {tt(T.kanban)}</button>
              <button onClick={() => setView("list")} style={toggleBtn(view === "list")}><ListIcon size={15} /> {tt(T.list)}</button>
            </div>
            <button onClick={() => setShowForm(true)} style={btnPrimary}>
              <Plus size={16} /> {tt(T.newProject)}
            </button>
          </div>
        </div>
      </div>

      {/* Search */}
      <div style={{ padding: "16px 28px 0" }}>
        <div style={{ position: "relative", maxWidth: 360 }}>
          <Search size={15} style={{ position: "absolute", top: 10, [isFa ? "right" : "left"]: 12, color: C.inkDim }} />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tt(T.search)}
            style={{ width: "100%", padding: isFa ? "9px 36px 9px 12px" : "9px 12px 9px 36px", borderRadius: 10, border: `1px solid ${C.paperDim}`, background: "#fff", fontFamily: "inherit", fontSize: 13 }}
          />
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: 28 }}>
        {view === "kanban" ? (
          <div className="rnd-scroll" style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
            {STATUSES.filter((s) => s.key !== "cancelled").map((s) => {
              const items = filtered.filter((p) => p.status === s.key);
              return (
                <div key={s.key} style={{ minWidth: 260, flex: "0 0 260px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: s.color, display: "inline-block" }} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{tt(s)}</span>
                    <span style={{ fontSize: 11, color: C.inkDim, marginInlineStart: 2 }}>{items.length}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 40 }}>
                    {items.length === 0 && <div style={{ fontSize: 12, color: C.inkDim, padding: 10 }}>{tt(T.noProjects)}</div>}
                    {items.map((p) => <ProjectCard key={p.id} p={p} isFa={isFa} onClick={() => { setSelectedId(p.id); setDetailTab("timeline"); }} />)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: `1px solid ${C.paperDim}` }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.paperDim, textAlign: isFa ? "right" : "left" }}>
                  {[T.code, T.title, T.outputType, T.status, T.assignee, T.due].map((h, i) => (
                    <th key={i} style={{ padding: "10px 14px", fontWeight: 600, color: C.inkDim }}>{tt(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const st = statusOf(p.status);
                  const ot = OUTPUT_TYPES[p.output_type];
                  return (
                    <tr key={p.id} onClick={() => { setSelectedId(p.id); setDetailTab("timeline"); }}
                      style={{ borderTop: `1px solid ${C.paperDim}`, cursor: "pointer" }}>
                      <td style={{ padding: "10px 14px" }} className="mono">{p.code}</td>
                      <td style={{ padding: "10px 14px" }}>{isFa ? p.title_fa : p.title_en}</td>
                      <td style={{ padding: "10px 14px" }}><Pill color={ot.color} text={tt(ot)} /></td>
                      <td style={{ padding: "10px 14px" }}><Pill color={st.color} text={tt(st)} /></td>
                      <td style={{ padding: "10px 14px" }}>{p.assigned || "—"}</td>
                      <td style={{ padding: "10px 14px", color: isOverdue(p) ? C.red : C.ink }}>{p.due_date || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selected && (
        <div style={{ position: "fixed", inset: 0, zIndex: 40 }}>
          <div onClick={() => setSelectedId(null)} style={{ position: "absolute", inset: 0, background: "rgba(20,24,28,.35)" }} />
          <div className="drawer-in" style={{
            position: "absolute", top: 0, bottom: 0, [isFa ? "right" : "left"]: 0, width: "min(440px, 92vw)",
            background: "#fff", boxShadow: "0 0 30px rgba(0,0,0,.2)", overflowY: "auto",
          }}>
            <div style={{ padding: 20, borderBottom: `1px solid ${C.paperDim}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div className="mono" style={{ fontSize: 12, color: C.inkDim }}>{selected.code}</div>
                  <h2 style={{ margin: "4px 0", fontSize: 17, fontWeight: 700 }}>{isFa ? selected.title_fa : selected.title_en}</h2>
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <Pill color={OUTPUT_TYPES[selected.output_type].color} text={tt(OUTPUT_TYPES[selected.output_type])} />
                    <Pill color={statusOf(selected.status).color} text={tt(statusOf(selected.status))} />
                  </div>
                </div>
                <button onClick={() => setSelectedId(null)} style={{ background: "none", border: "none", cursor: "pointer", color: C.inkDim }}><X size={18} /></button>
              </div>

              {selected.went_to_production && (
                <div style={{ marginTop: 12, background: "#EEF2F4", border: `1px solid ${C.steelLight}`, borderRadius: 10, padding: "8px 12px", fontSize: 12, display: "flex", gap: 8, alignItems: "center" }}>
                  <Factory size={14} color={C.steel} />
                  <span>{tt(T.productionBanner)} <span className="mono">{selected.production_order_id}</span></span>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14, fontSize: 13 }}>
                <Field label={tt(T.order)} value={selected.order_code || "—"} mono />
                <Field label={tt(T.assignee)} value={selected.assigned || "—"} />
                <Field label={tt(T.estCost)} value={fmtMoney(selected.estimated_cost)} />
                <Field label={tt(T.actCost)} value={fmtMoney(selected.actual_cost)} />
                <Field label={tt(T.due)} value={selected.due_date || "—"} highlight={isOverdue(selected)} />
              </div>

              {selected.description_fa && isFa && <p style={{ marginTop: 12, fontSize: 13, color: C.inkDim, lineHeight: 1.7 }}>{selected.description_fa}</p>}

              <div style={{ marginTop: 14 }}>
                <label style={{ fontSize: 12, color: C.inkDim }}>{tt(T.changeStatus)}</label>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <select value={selected.status} onChange={(e) => changeStatus(selected.id, e.target.value)} style={selectStyle}>
                    {STATUSES.map((s) => <option key={s.key} value={s.key}>{tt(s)}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", borderBottom: `1px solid ${C.paperDim}` }}>
              {["timeline", "files", "comments", "cost"].map((k) => (
                <button key={k} onClick={() => setDetailTab(k)}
                  style={{
                    flex: 1, padding: "10px 0", fontSize: 12, background: "none", cursor: "pointer",
                    border: "none", borderBottom: detailTab === k ? `2px solid ${C.copper}` : "2px solid transparent",
                    color: detailTab === k ? C.ink : C.inkDim, fontWeight: detailTab === k ? 600 : 400,
                  }}>
                  {tt(T.detailTabs[k])}
                </button>
              ))}
            </div>

            <div style={{ padding: 20 }}>
              {detailTab === "timeline" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {(history[selected.id] || []).map((h, i) => {
                    const st = statusOf(h.status);
                    return (
                      <div key={i} style={{ display: "flex", gap: 10 }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <span style={{ width: 9, height: 9, borderRadius: 999, background: st.color }} />
                          {i < (history[selected.id] || []).length - 1 && <span style={{ width: 1, flex: 1, background: C.paperDim, marginTop: 2 }} />}
                        </div>
                        <div style={{ paddingBottom: 12 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{tt(st)}</div>
                          {h.note_fa && isFa && <div style={{ fontSize: 12, color: C.inkDim, marginTop: 2 }}>{h.note_fa}</div>}
                          <div style={{ fontSize: 11, color: C.inkDim, marginTop: 2 }}>{h.by} · {h.at}</div>
                        </div>
                      </div>
                    );
                  })}
                  {!(history[selected.id] || []).length && <Empty icon={Clock} text={isFa ? "بدون تاریخچه" : "No history yet"} />}
                </div>
              )}

              {detailTab === "files" && (
                <div>
                  <label style={{ ...btnGhostLight, display: "inline-flex", cursor: "pointer" }}>
                    <Upload size={14} /> {tt(T.uploadFile)}
                    <input type="file" style={{ display: "none" }} onChange={(e) => addDocument(selected.id, e.target.files[0])} />
                  </label>
                  <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                    {(documents[selected.id] || []).map((d, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "8px 10px", background: C.paper, borderRadius: 8 }}>
                        <Paperclip size={14} color={C.inkDim} />
                        <span className="mono" style={{ flex: 1 }}>{d.name}</span>
                        <span style={{ fontSize: 11, color: C.inkDim }}>{d.by} · {d.at}</span>
                      </div>
                    ))}
                    {!(documents[selected.id] || []).length && <Empty icon={FileText} text={tt(T.noFiles)} />}
                  </div>
                </div>
              )}

              {detailTab === "comments" && (
                <CommentBox
                  items={comments[selected.id] || []}
                  onAdd={(text) => addComment(selected.id, text)}
                  isFa={isFa} T={T}
                />
              )}

              {detailTab === "cost" && (
                <CostBox
                  items={costs[selected.id] || []}
                  onAdd={(item) => addCost(selected.id, item)}
                  isFa={isFa} T={T}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create form modal */}
      {showForm && (
        <FormModal
          onClose={() => setShowForm(false)}
          onSubmit={createProject}
          isFa={isFa} T={T}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 20, [isFa ? "right" : "left"]: 20, background: C.graphite900, color: "#fff", padding: "10px 16px", borderRadius: 10, fontSize: 13, display: "flex", gap: 8, alignItems: "center", zIndex: 60 }}>
          <CheckCircle2 size={15} color={C.greenLight} /> {toast}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small pieces                                                       */
/* ------------------------------------------------------------------ */

function ProjectCard({ p, isFa, onClick }) {
  const ot = OUTPUT_TYPES[p.output_type];
  const st = statusOf(p.status);
  const overdue = isOverdue(p);
  return (
    <div className="card" onClick={onClick} style={{
      background: "#fff", borderRadius: 12, padding: 12, cursor: "pointer",
      borderInlineStart: `4px solid ${ot.color}`, border: `1px solid ${C.paperDim}`, borderInlineStartWidth: 4,
    }}>
      <div className="mono" style={{ fontSize: 11, color: C.inkDim }}>{p.code}</div>
      <div style={{ fontSize: 13, fontWeight: 600, margin: "4px 0 8px", lineHeight: 1.5 }}>{isFa ? p.title_fa : p.title_en}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: C.inkDim }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {p.priority === 1 && <Flag size={12} color={C.red} />}
          <Calendar size={12} />
          <span style={{ color: overdue ? C.red : C.inkDim }}>{p.due_date || "—"}</span>
        </span>
        <span>{p.assigned ? p.assigned.split(" ")[0] : "—"}</span>
      </div>
    </div>
  );
}

function Pill({ color, text }) {
  return (
    <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, background: color + "22", color, fontWeight: 600, whiteSpace: "nowrap" }}>
      {text}
    </span>
  );
}

function Field({ label, value, mono, highlight }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: C.inkDim }}>{label}</div>
      <div className={mono ? "mono" : ""} style={{ fontSize: 13, fontWeight: 600, color: highlight ? C.red : C.ink }}>{value}</div>
    </div>
  );
}

function Empty({ icon: Icon, text }) {
  return (
    <div style={{ textAlign: "center", padding: "24px 0", color: C.inkDim }}>
      <Icon size={22} style={{ marginBottom: 6, opacity: .5 }} />
      <div style={{ fontSize: 12 }}>{text}</div>
    </div>
  );
}

function CommentBox({ items, onAdd, isFa, T }) {
  const [text, setText] = useState("");
  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        {items.map((c, i) => (
          <div key={i} style={{ background: C.paper, borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 13 }}>{c.text}</div>
            <div style={{ fontSize: 11, color: C.inkDim, marginTop: 4 }}>{c.by} · {c.at}</div>
          </div>
        ))}
        {!items.length && <Empty icon={MessageSquare} text={T.noComments[isFa ? "fa" : "en"]} />}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={T.addNote[isFa ? "fa" : "en"]} style={{ ...selectStyle, flex: 1 }} />
        <button onClick={() => { onAdd(text); setText(""); }} style={btnPrimary}>{T.send[isFa ? "fa" : "en"]}</button>
      </div>
    </div>
  );
}

function CostBox({ items, onAdd, isFa, T }) {
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        {items.map((c, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "8px 10px", background: C.paper, borderRadius: 8 }}>
            <span>{c.desc}</span>
            <span className="mono" style={{ fontWeight: 600 }}>{fmtMoney(c.amount)}</span>
          </div>
        ))}
        {!items.length && <Empty icon={DollarSign} text={isFa ? "هنوز هزینه‌ای ثبت نشده." : "No cost items yet."} />}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={T.desc[isFa ? "fa" : "en"]} style={selectStyle} />
        <div style={{ display: "flex", gap: 8 }}>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={T.amount[isFa ? "fa" : "en"]} type="number" style={{ ...selectStyle, flex: 1 }} />
          <button onClick={() => { if (desc && amount) { onAdd({ desc, amount: Number(amount), type: "other" }); setDesc(""); setAmount(""); } }} style={btnPrimary}>{T.add[isFa ? "fa" : "en"]}</button>
        </div>
      </div>
    </div>
  );
}

function FormModal({ onClose, onSubmit, isFa, T }) {
  const [data, setData] = useState({ output_type: "transformer_sample", priority: 2 });
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(20,24,28,.45)" }} />
      <div style={{ position: "relative", background: "#fff", borderRadius: 16, padding: 24, width: "min(480px, 92vw)", maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{T.form.heading[isFa ? "fa" : "en"]}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.inkDim }}><X size={18} /></button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <LabeledInput label={T.form.titleFa[isFa ? "fa" : "en"]} onChange={(v) => set("title_fa", v)} />
          <LabeledInput label={T.form.titleEn[isFa ? "fa" : "en"]} onChange={(v) => set("title_en", v)} />

          <div>
            <label style={labelStyle}>{T.outputType[isFa ? "fa" : "en"]}</label>
            <select value={data.output_type} onChange={(e) => set("output_type", e.target.value)} style={selectStyle}>
              {Object.entries(OUTPUT_TYPES).map(([k, v]) => <option key={k} value={k}>{v[isFa ? "fa" : "en"]}</option>)}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <LabeledInput label={T.form.orderCode[isFa ? "fa" : "en"]} onChange={(v) => set("order_code", v)} />
            <div>
              <label style={labelStyle}>{T.form.priority[isFa ? "fa" : "en"]}</label>
              <select value={data.priority} onChange={(e) => set("priority", e.target.value)} style={selectStyle}>
                {T.form.priorityOpts.map((o) => <option key={o.v} value={o.v}>{o[isFa ? "fa" : "en"]}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <LabeledInput label={T.estCost[isFa ? "fa" : "en"]} type="number" onChange={(v) => set("estimated_cost", v)} />
            <LabeledInput label={T.due[isFa ? "fa" : "en"]} type="date" onChange={(v) => set("due_date", v)} />
          </div>

          <div>
            <label style={labelStyle}>{T.form.description[isFa ? "fa" : "en"]}</label>
            <textarea rows={3} onChange={(e) => set("description_fa", e.target.value)} style={{ ...selectStyle, resize: "vertical" }} />
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <button onClick={onClose} style={btnGhostLight}>{T.form.cancel[isFa ? "fa" : "en"]}</button>
            <button
              disabled={!data.title_fa}
              onClick={() => onSubmit(data)}
              style={{ ...btnPrimary, flex: 1, justifyContent: "center", opacity: data.title_fa ? 1 : .5 }}>
              {T.form.submit[isFa ? "fa" : "en"]}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LabeledInput({ label, onChange, type = "text" }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type={type} onChange={(e) => onChange(e.target.value)} style={selectStyle} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared inline styles                                                */
/* ------------------------------------------------------------------ */

const btnPrimary = {
  display: "inline-flex", alignItems: "center", gap: 6, background: C.copper, color: "#fff",
  border: "none", borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
const btnGhost = {
  display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "#fff",
  border: `1px solid ${C.graphiteLine}`, borderRadius: 10, padding: "8px 12px", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
};
const btnGhostLight = {
  display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", color: C.ink,
  border: `1px solid ${C.paperDim}`, borderRadius: 10, padding: "9px 14px", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
};
const toggleBtn = (active) => ({
  display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, border: "none", cursor: "pointer",
  background: active ? "#fff" : "transparent", color: active ? C.ink : "#9BA6AF", fontSize: 12, fontWeight: 600, fontFamily: "inherit",
});
const selectStyle = {
  width: "100%", padding: "9px 10px", borderRadius: 8, border: `1px solid ${C.paperDim}`, fontSize: 13, fontFamily: "inherit", background: "#fff",
};
const labelStyle = { fontSize: 12, color: C.inkDim, marginBottom: 4, display: "block" };
