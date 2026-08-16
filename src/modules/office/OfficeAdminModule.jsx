import { useMemo, useState } from 'react';
import { CalendarDays, ClipboardList, FileText, Search, Users, Clock, Archive, CheckSquare, Plus, Edit3, Send, FolderOpen, Stamp } from 'lucide-react';
import ReferralPanel from '../../components/referrals/ReferralPanel';
import SharedFilesPanel from '../../components/shared/SharedFilesPanel';
import JalaliDateInput from '../../components/JalaliDateInput';
import { createReferral } from '../../lib/referralApi';
import { getFriendlyErrorMessage } from '../../lib/errorMessages';
import './OfficeAdminModule.css';

const initialLetters = [
  { id: 1, no: 'AD-IN-1405-0012', type: 'وارده', title: 'نامه پیگیری خرید قطعات', party: 'تأمین‌کننده', date: '2026-08-09', status: 'ارجاع‌شده', priority: 'عادی', summary: 'پیگیری تأمین قطعات سفارش‌های تولید.' },
  { id: 2, no: 'AD-OUT-1405-0008', type: 'صادره', title: 'ارسال برنامه جلسه تولید', party: 'مدیریت', date: '2026-08-08', status: 'ثبت‌شده', priority: 'مهم', summary: 'برنامه جلسه هماهنگی تولید و انبار.' },
];
const initialMeetings = [
  { id: 1, title: 'جلسه هماهنگی تولید و انبار', date: '2026-08-11', owner: 'مدیر کل', status: 'برنامه‌ریزی‌شده', attendees: 'تولید، انبار، مالی', result: '' },
  { id: 2, title: 'جلسه بررسی سفارش‌های فوری', date: '2026-08-12', owner: 'فروش', status: 'در انتظار', attendees: 'فروش، تولید', result: '' },
];
const initialLeaves = [
  { id: 1, person: 'کاربر نمونه', type: 'مرخصی ساعتی', startDate: '2026-08-13', endDate: '2026-08-13', status: 'در انتظار تأیید اداری', reason: 'نمونه درخواست' },
];
const initialDocs = [
  { id: 1, code: 'ARC-1405-0001', title: 'قرارداد تأمین قطعات', category: 'قرارداد', owner: 'اداری', date: '2026-08-09', status: 'بایگانی فعال', note: 'نسخه امضا شده در فایل‌های مشترک بارگذاری شود.' },
];

function today() { return new Date().toISOString().slice(0, 10); }
function nextId(rows) { return Math.max(0, ...rows.map((r) => Number(r.id || 0))) + 1; }
function fmtDate(v) { if (!v) return '—'; try { return new Date(v).toLocaleDateString('fa-IR'); } catch { return v; } }

export default function OfficeAdminModule() {
  const [tab, setTab] = useState('overview');
  const [q, setQ] = useState('');
  const [letters, setLetters] = useState(initialLetters);
  const [meetings, setMeetings] = useState(initialMeetings);
  const [leaves, setLeaves] = useState(initialLeaves);
  const [docs, setDocs] = useState(initialDocs);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const filteredLetters = useMemo(() => letters.filter((l) => `${l.no} ${l.title} ${l.party} ${l.summary}`.includes(q)), [letters, q]);
  const openLeaves = leaves.filter((l) => !['تأیید نهایی', 'رد شده'].includes(l.status)).length;

  function saveLetter(payload) {
    setLetters((rows) => payload.id ? rows.map((r) => r.id === payload.id ? payload : r) : [{ ...payload, id: nextId(rows), no: payload.no || `AD-${payload.type === 'وارده' ? 'IN' : 'OUT'}-1405-${String(nextId(rows)).padStart(4, '0')}` }, ...rows]);
    setModal(null); setNotice('نامه/مکاتبه ذخیره شد.');
  }
  function saveMeeting(payload) {
    setMeetings((rows) => payload.id ? rows.map((r) => r.id === payload.id ? payload : r) : [{ ...payload, id: nextId(rows) }, ...rows]);
    setModal(null); setNotice('جلسه/صورتجلسه ذخیره شد.');
  }
  function saveDoc(payload) {
    setDocs((rows) => payload.id ? rows.map((r) => r.id === payload.id ? payload : r) : [{ ...payload, id: nextId(rows), code: payload.code || `ARC-1405-${String(nextId(rows)).padStart(4, '0')}` }, ...rows]);
    setModal(null); setNotice('سند اداری ذخیره شد.');
  }
  async function saveLeave(payload) {
    setBusy(true); setNotice('');
    try {
      const row = payload.id ? payload : { ...payload, id: nextId(leaves), status: 'در انتظار تأیید اداری' };
      setLeaves((rows) => payload.id ? rows.map((r) => r.id === payload.id ? row : r) : [row, ...rows]);
      await createReferral({
        sourceModule: 'office',
        targetModule: 'admin',
        referralType: 'leave_request',
        title: `درخواست مرخصی ${row.person || ''}`,
        description: `نوع: ${row.type}\nشروع: ${fmtDate(row.startDate)}\nپایان: ${fmtDate(row.endDate)}\nعلت: ${row.reason || '—'}\nاین درخواست پس از بررسی اداری برای تأیید نهایی مدیر کل ارسال شده است.`,
        priority: 2,
        dueDate: row.startDate,
      });
      setModal(null); setNotice('درخواست مرخصی ثبت و برای تأیید مدیر کل ارجاع شد.');
    } catch (e) {
      setNotice(getFriendlyErrorMessage(e, 'خطا در ثبت درخواست مرخصی'));
    } finally { setBusy(false); }
  }
  function changeLeaveStatus(leave, status) {
    setLeaves((rows) => rows.map((r) => r.id === leave.id ? { ...r, status } : r));
    setNotice(`وضعیت مرخصی «${leave.person}» به «${status}» تغییر کرد.`);
  }

  return <div className="office-page" dir="rtl">
    <header className="office-hero"><div><div className="eyebrow">Office Automation · Secretariat · Cartable</div><h1>امور اداری</h1><p>دبیرخانه، نامه‌ها، جلسات، کارتابل، اسناد اداری، مرخصی، حضور و هماهنگی بین واحدها.</p></div><div className="office-actions"><button className="primary" onClick={() => setModal({ type: 'letter' })}><Plus size={15}/> نامه جدید</button><button onClick={() => setModal({ type: 'meeting' })}><CalendarDays size={15}/> جلسه</button><button onClick={() => setModal({ type: 'leave' })}><Clock size={15}/> درخواست مرخصی</button><button onClick={() => setTab('referrals')}><Send size={15}/> ارجاع و اسناد</button></div></header>
    {notice && <div className="office-message">{notice}</div>}
    <nav className="office-tabs">{[['overview','نمای کلی'],['cartable','کارتابل'],['letters','دبیرخانه/نامه‌ها'],['archive','بایگانی اسناد'],['meetings','جلسات'],['hr','مرخصی و حضور'],['referrals','ارجاع و اسناد'],['settings','تنظیمات']].map(([k,l])=><button key={k} className={tab===k?'active':''} onClick={()=>setTab(k)}>{l}</button>)}</nav>

    {tab==='overview'&&<><section className="office-kpis"><Kpi icon="📨" label="نامه‌ها" value={letters.length}/><Kpi icon="🗓" label="جلسات" value={meetings.length}/><Kpi icon="✅" label="وظایف باز" value={4}/><Kpi icon="🏖" label="درخواست مرخصی" value={openLeaves}/></section><div className="office-grid three overview-full"><Card icon={FileText} title="نامه‌های اخیر" action={<button onClick={()=>setTab('letters')}>مشاهده</button>}><List rows={letters.slice(0,5).map(l=>`${l.no} · ${l.title}`)}/></Card><Card icon={CalendarDays} title="جلسات پیش‌رو" action={<button onClick={()=>setTab('meetings')}>مشاهده</button>}><List rows={meetings.slice(0,5).map(m=>`${fmtDate(m.date)} · ${m.title}`)}/></Card><Card icon={CheckSquare} title="اقدام‌های اداری"><List rows={['ثبت صورتجلسه تولید','پیگیری نامه تأمین‌کننده','آرشیو اسناد مالی','بررسی مرخصی‌های باز']}/></Card></div></>}
    {tab==='letters'&&<section className="office-card"><div className="section-head"><Title icon={FileText} title="دبیرخانه و مکاتبات"/><div className="office-head-actions"><button onClick={()=>setModal({type:'letter'})}>＋ نامه</button><div className="filters"><Search size={16}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="جست‌وجوی نامه..."/></div></div></div><Table headers={['شماره','نوع','عنوان','طرف مکاتبه','تاریخ','اولویت','وضعیت','عملیات']} rows={filteredLetters.map(l=>[l.no,l.type,l.title,l.party,fmtDate(l.date),l.priority,l.status,<button onClick={()=>setModal({type:'letter', item:l})}><Edit3 size={13}/> ویرایش</button>])}/></section>}
    {tab==='meetings'&&<section className="office-card"><div className="section-head"><Title icon={CalendarDays} title="مدیریت جلسات و صورتجلسه"/><button onClick={()=>setModal({type:'meeting'})}>＋ جلسه</button></div><Table headers={['عنوان','تاریخ','مسئول','حاضرین','وضعیت','نتیجه','عملیات']} rows={meetings.map(m=>[m.title,fmtDate(m.date),m.owner,m.attendees,m.status,m.result||'—',<button onClick={()=>setModal({type:'meeting', item:m})}>ویرایش</button>])}/></section>}
    {tab==='hr'&&<section className="office-card"><div className="section-head"><Title icon={Clock} title="مرخصی، مأموریت و حضور"/><button onClick={()=>setModal({type:'leave'})}>＋ درخواست مرخصی</button></div><Table headers={['شخص','نوع','شروع','پایان','علت','وضعیت','عملیات']} rows={leaves.map(l=>[l.person,l.type,fmtDate(l.startDate),fmtDate(l.endDate),l.reason,l.status,<div className="office-row-actions"><button onClick={()=>changeLeaveStatus(l,'تأیید اداری')}>تأیید اداری</button><button onClick={()=>changeLeaveStatus(l,'تأیید نهایی')}>تأیید نهایی</button><button onClick={()=>changeLeaveStatus(l,'رد شده')}>رد</button><button onClick={()=>setModal({type:'leave', item:l})}>ویرایش</button></div>])}/><p className="office-note">درخواست مرخصی از هر ماژول از طریق دکمه «درخواست مرخصی» در ارجاعات قابل ثبت است و پس از پاسخ/تأیید، همان بخش وضعیت را در ارجاعات می‌بیند.</p></section>}
    {tab==='archive'&&<section className="office-card"><div className="section-head"><Title icon={Archive} title="بایگانی اسناد اداری"/><button onClick={()=>setModal({type:'doc'})}>＋ سند</button></div><Table headers={['کد','عنوان','دسته','مالک','تاریخ','وضعیت','یادداشت','عملیات']} rows={docs.map(d=>[d.code,d.title,d.category,d.owner,fmtDate(d.date),d.status,d.note,<button onClick={()=>setModal({type:'doc', item:d})}>ویرایش</button>])}/><SharedFilesPanel sourceModule="office" /></section>}
    {tab==='cartable'&&<section className="office-card"><Title icon={ClipboardList} title="کارتابل اداری"/><div className="office-cartable-grid"><Cartable title="نیازمند اقدام" rows={['بررسی مرخصی‌های باز','ثبت نتیجه جلسه تولید','ارجاع نامه خرید به انبار']}/><Cartable title="در انتظار پاسخ" rows={['پاسخ تأمین‌کننده قطعات','تأیید مدیر کل برای مرخصی']}/><Cartable title="آرشیو امروز" rows={['قرارداد تأمین قطعات','صورتجلسه تولید']}/></div></section>}
    {tab==='referrals'&&<div className="office-grid"><ReferralPanel sourceModule="office" title="ارجاع و اسناد اداری" defaultTarget="admin" /></div>}
    {tab==='settings'&&<section className="office-card"><Title icon={Users} title="تنظیمات اداری"/><div className="settings-list"><span>شماره‌گذاری نامه‌ها</span><span>سطح دسترسی اسناد</span><span>امضا و بایگانی</span><span>قالب صورتجلسه</span><span>فرآیند مرخصی</span><span>دسته‌بندی اسناد</span></div></section>}

    {modal?.type === 'letter' && <LetterModal initial={modal.item} onClose={()=>setModal(null)} onSubmit={saveLetter}/>} 
    {modal?.type === 'meeting' && <MeetingModal initial={modal.item} onClose={()=>setModal(null)} onSubmit={saveMeeting}/>} 
    {modal?.type === 'doc' && <DocModal initial={modal.item} onClose={()=>setModal(null)} onSubmit={saveDoc}/>} 
    {modal?.type === 'leave' && <LeaveModal initial={modal.item} busy={busy} onClose={()=>setModal(null)} onSubmit={saveLeave}/>} 
  </div>
}
function Kpi({icon,label,value}){return <div className="office-kpi"><i>{icon}</i><span>{label}</span><b>{value}</b></div>}
function Title({icon:Icon,title}){return <div className="office-title"><Icon size={18}/><b>{title}</b></div>}
function Card({icon,title,children,action}){return <section className="office-card"><div className="office-title-line"><Title icon={icon} title={title}/>{action}</div>{children}</section>}
function List({rows}){return <div className="office-list">{rows.map((r,i)=><article key={i}>{r}</article>)}</div>}
function Table({headers,rows}){return <div className="office-table"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c}</td>)}</tr>)}</tbody></table></div>}
function Cartable({title,rows}){return <div className="cartable-box"><h3>{title}</h3><List rows={rows}/></div>}
function OfficeModal({title,onClose,children}){return <div className="office-modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className="office-modal"><header><h3>{title}</h3><button onClick={onClose}>×</button></header><div>{children}</div></div></div>}
function LetterModal({initial,onClose,onSubmit}){const [f,setF]=useState({id:initial?.id||null,no:initial?.no||'',type:initial?.type||'وارده',title:initial?.title||'',party:initial?.party||'',date:initial?.date||today(),status:initial?.status||'ثبت‌شده',priority:initial?.priority||'عادی',summary:initial?.summary||''});return <OfficeModal title={initial?'ویرایش نامه':'ثبت نامه'} onClose={onClose}><Form onCancel={onClose} onSubmit={()=>onSubmit(f)}><Field label="شماره"><input value={f.no} onChange={e=>setF({...f,no:e.target.value})} placeholder="خودکار در صورت خالی بودن"/></Field><Field label="نوع"><select value={f.type} onChange={e=>setF({...f,type:e.target.value})}><option>وارده</option><option>صادره</option><option>داخلی</option></select></Field><Field label="عنوان"><input value={f.title} onChange={e=>setF({...f,title:e.target.value})} required/></Field><Field label="طرف مکاتبه"><input value={f.party} onChange={e=>setF({...f,party:e.target.value})}/></Field><Field label="تاریخ"><JalaliDateInput value={f.date} onChange={v=>setF({...f,date:v})}/></Field><Field label="اولویت"><select value={f.priority} onChange={e=>setF({...f,priority:e.target.value})}><option>عادی</option><option>مهم</option><option>فوری</option></select></Field><Field label="وضعیت"><input value={f.status} onChange={e=>setF({...f,status:e.target.value})}/></Field><Field label="شرح" full><textarea value={f.summary} onChange={e=>setF({...f,summary:e.target.value})}/></Field></Form></OfficeModal>}
function MeetingModal({initial,onClose,onSubmit}){const [f,setF]=useState({id:initial?.id||null,title:initial?.title||'',date:initial?.date||today(),owner:initial?.owner||'',status:initial?.status||'برنامه‌ریزی‌شده',attendees:initial?.attendees||'',result:initial?.result||''});return <OfficeModal title={initial?'ویرایش جلسه':'ثبت جلسه/صورتجلسه'} onClose={onClose}><Form onCancel={onClose} onSubmit={()=>onSubmit(f)}><Field label="عنوان"><input value={f.title} onChange={e=>setF({...f,title:e.target.value})} required/></Field><Field label="تاریخ"><JalaliDateInput value={f.date} onChange={v=>setF({...f,date:v})}/></Field><Field label="مسئول"><input value={f.owner} onChange={e=>setF({...f,owner:e.target.value})}/></Field><Field label="وضعیت"><input value={f.status} onChange={e=>setF({...f,status:e.target.value})}/></Field><Field label="حاضرین" full><textarea value={f.attendees} onChange={e=>setF({...f,attendees:e.target.value})}/></Field><Field label="نتیجه/مصوبات" full><textarea value={f.result} onChange={e=>setF({...f,result:e.target.value})}/></Field></Form></OfficeModal>}
function DocModal({initial,onClose,onSubmit}){const [f,setF]=useState({id:initial?.id||null,code:initial?.code||'',title:initial?.title||'',category:initial?.category||'عمومی',owner:initial?.owner||'اداری',date:initial?.date||today(),status:initial?.status||'بایگانی فعال',note:initial?.note||''});return <OfficeModal title={initial?'ویرایش سند اداری':'ثبت سند اداری'} onClose={onClose}><Form onCancel={onClose} onSubmit={()=>onSubmit(f)}><Field label="کد"><input value={f.code} onChange={e=>setF({...f,code:e.target.value})} placeholder="خودکار در صورت خالی بودن"/></Field><Field label="عنوان"><input value={f.title} onChange={e=>setF({...f,title:e.target.value})} required/></Field><Field label="دسته"><input value={f.category} onChange={e=>setF({...f,category:e.target.value})}/></Field><Field label="مالک"><input value={f.owner} onChange={e=>setF({...f,owner:e.target.value})}/></Field><Field label="تاریخ"><JalaliDateInput value={f.date} onChange={v=>setF({...f,date:v})}/></Field><Field label="وضعیت"><input value={f.status} onChange={e=>setF({...f,status:e.target.value})}/></Field><Field label="یادداشت" full><textarea value={f.note} onChange={e=>setF({...f,note:e.target.value})}/></Field></Form></OfficeModal>}
function LeaveModal({initial,busy,onClose,onSubmit}){const [f,setF]=useState({id:initial?.id||null,person:initial?.person||'',type:initial?.type||'مرخصی روزانه',startDate:initial?.startDate||today(),endDate:initial?.endDate||today(),status:initial?.status||'در انتظار تأیید اداری',reason:initial?.reason||''});return <OfficeModal title={initial?'ویرایش مرخصی':'ثبت درخواست مرخصی'} onClose={onClose}><Form onCancel={onClose} onSubmit={()=>onSubmit(f)} busy={busy}><Field label="شخص"><input value={f.person} onChange={e=>setF({...f,person:e.target.value})} required/></Field><Field label="نوع"><select value={f.type} onChange={e=>setF({...f,type:e.target.value})}><option>مرخصی روزانه</option><option>مرخصی ساعتی</option><option>مأموریت</option><option>استعلاجی</option></select></Field><Field label="شروع"><JalaliDateInput value={f.startDate} onChange={v=>setF({...f,startDate:v})}/></Field><Field label="پایان"><JalaliDateInput value={f.endDate} onChange={v=>setF({...f,endDate:v})}/></Field><Field label="وضعیت"><input value={f.status} onChange={e=>setF({...f,status:e.target.value})}/></Field><Field label="علت" full><textarea value={f.reason} onChange={e=>setF({...f,reason:e.target.value})}/></Field></Form></OfficeModal>}
function Form({children,onSubmit,onCancel,busy}){return <form onSubmit={e=>{e.preventDefault();onSubmit();}}><div className="office-form-grid">{children}</div><div className="office-form-actions"><button type="button" onClick={onCancel}>انصراف</button><button disabled={busy} type="submit">ذخیره</button></div></form>}
function Field({label,children,full}){return <label className={full?'full':''}><span>{label}</span>{children}</label>}
