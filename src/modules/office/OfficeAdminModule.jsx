import { useMemo, useState } from 'react';
import { CalendarDays, ClipboardList, FileText, Search, Users, Clock, Archive, CheckSquare } from 'lucide-react';
import ReferralPanel from '../../components/referrals/ReferralPanel';
import SharedFilesPanel from '../../components/shared/SharedFilesPanel';
import './OfficeAdminModule.css';

const lettersSeed = [
  { id: 1, no: 'AD-IN-1405-0012', type: 'وارده', title: 'نامه پیگیری خرید قطعات', from: 'تأمین‌کننده', date: '۱۴۰۵/۰۵/۱۸', status: 'ارجاع‌شده' },
  { id: 2, no: 'AD-OUT-1405-0008', type: 'صادره', title: 'ارسال برنامه جلسه تولید', from: 'مدیریت', date: '۱۴۰۵/۰۵/۱۷', status: 'ثبت‌شده' },
];
const meetingsSeed = [
  { id: 1, title: 'جلسه هماهنگی تولید و انبار', date: '۱۴۰۵/۰۵/۲۰', owner: 'مدیر کل', status: 'برنامه‌ریزی‌شده' },
  { id: 2, title: 'جلسه بررسی سفارش‌های فوری', date: '۱۴۰۵/۰۵/۲۱', owner: 'فروش', status: 'در انتظار' },
];
const leavesSeed = [
  { id: 1, person: 'کاربر نمونه', type: 'مرخصی ساعتی', date: '۱۴۰۵/۰۵/۲۲', status: 'در انتظار تأیید' },
];

export default function OfficeAdminModule() {
  const [tab, setTab] = useState('overview');
  const [q, setQ] = useState('');
  const letters = useMemo(() => lettersSeed.filter((l) => `${l.no} ${l.title} ${l.from}`.includes(q)), [q]);
  return <div className="office-page" dir="rtl">
    <header className="office-hero"><div><div className="eyebrow">Office Automation · Secretariat · Cartable</div><h1>امور اداری</h1><p>دبیرخانه، نامه‌ها، جلسات، کارتابل، اسناد اداری، مرخصی، حضور و هماهنگی بین واحدها.</p></div><div className="office-actions"><button className="primary" onClick={() => setTab('letters')}>نامه جدید</button><button onClick={() => setTab('meetings')}>جلسه</button><button onClick={() => setTab('referrals')}>ارجاع و اسناد</button></div></header>
    <nav className="office-tabs">{[['overview','نمای کلی'],['cartable','کارتابل'],['letters','دبیرخانه/نامه‌ها'],['archive','بایگانی اسناد'],['meetings','جلسات'],['hr','مرخصی و حضور'],['referrals','ارجاع و اسناد'],['settings','تنظیمات']].map(([k,l])=><button key={k} className={tab===k?'active':''} onClick={()=>setTab(k)}>{l}</button>)}</nav>
    {tab==='overview'&&<><section className="office-kpis"><Kpi icon="📨" label="نامه‌ها" value={lettersSeed.length}/><Kpi icon="🗓" label="جلسات" value={meetingsSeed.length}/><Kpi icon="✅" label="وظایف باز" value={4}/><Kpi icon="🏖" label="درخواست مرخصی" value={leavesSeed.length}/></section><div className="office-grid three"><Card icon={FileText} title="نامه‌های اخیر"><List rows={lettersSeed.map(l=>`${l.no} · ${l.title}`)}/></Card><Card icon={CalendarDays} title="جلسات پیش‌رو"><List rows={meetingsSeed.map(m=>`${m.date} · ${m.title}`)}/></Card><Card icon={CheckSquare} title="اقدام‌های اداری"><List rows={['ثبت صورتجلسه تولید','پیگیری نامه تأمین‌کننده','آرشیو اسناد مالی']}/></Card></div></>}
    {tab==='letters'&&<section className="office-card"><div className="section-head"><Title icon={FileText} title="دبیرخانه و مکاتبات"/><div className="filters"><Search size={16}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="جست‌وجوی نامه..."/></div></div><Table headers={['شماره','نوع','عنوان','فرستنده/گیرنده','تاریخ','وضعیت']} rows={letters.map(l=>[l.no,l.type,l.title,l.from,l.date,l.status])}/></section>}
    {tab==='meetings'&&<section className="office-card"><Title icon={CalendarDays} title="مدیریت جلسات"/><Table headers={['عنوان','تاریخ','مسئول','وضعیت']} rows={meetingsSeed.map(m=>[m.title,m.date,m.owner,m.status])}/></section>}
    {tab==='hr'&&<section className="office-card"><Title icon={Clock} title="مرخصی، مأموریت و حضور"/><Table headers={['شخص','نوع','تاریخ','وضعیت']} rows={leavesSeed.map(l=>[l.person,l.type,l.date,l.status])}/></section>}
    {tab==='archive'&&<section className="office-card"><Title icon={Archive} title="بایگانی اسناد اداری"/><SharedFilesPanel sourceModule="office" /></section>}
    {tab==='cartable'&&<section className="office-card"><Title icon={ClipboardList} title="کارتابل اداری"/><List rows={['ارجاع نامه خرید به انبار','درخواست تأیید مرخصی','ثبت خروجی جلسه تولید']}/></section>}
    {tab==='referrals'&&<div className="office-grid"><ReferralPanel sourceModule="admin" title="ارجاع و اسناد اداری" defaultTarget="orders" /></div>}
    {tab==='settings'&&<section className="office-card"><Title icon={Users} title="تنظیمات اداری"/><div className="settings-list"><span>شماره‌گذاری نامه‌ها</span><span>سطح دسترسی اسناد</span><span>امضا و بایگانی</span><span>قالب صورتجلسه</span></div></section>}
  </div>
}
function Kpi({icon,label,value}){return <div className="office-kpi"><i>{icon}</i><span>{label}</span><b>{value}</b></div>}
function Title({icon:Icon,title}){return <div className="office-title"><Icon size={18}/><b>{title}</b></div>}
function Card({icon,title,children}){return <section className="office-card"><Title icon={icon} title={title}/>{children}</section>}
function List({rows}){return <div className="office-list">{rows.map((r,i)=><article key={i}>{r}</article>)}</div>}
function Table({headers,rows}){return <div className="office-table"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c}</td>)}</tr>)}</tbody></table></div>}
