-- فقط خواندنی است؛ هیچ INSERT / UPDATE / DELETE ندارد.
-- این بخش را در Supabase SQL Editor اجرا کنید و نتیجه هر SELECT را جداگانه به CSV دانلود کنید.

-- 1) مشتریان فعلی CRM
select
  c.id as customer_id,
  c.company_name,
  c.contact_person_name,
  c.contact_phone,
  c.contact_email,
  c.address,
  c.tier::text as tier,
  c.notes,
  c.is_active,
  c.created_at,
  c.updated_at
from public.customers c
order by c.company_name, c.id;

-- 2) اشخاص مالی، به‌خصوص مشتریان، برای اتصال به حسابداری
select
  fp.id as finance_party_id,
  fp.party_type::text as party_type,
  fp.display_name,
  fp.linked_customer_id,
  fp.phone,
  fp.email,
  fp.address,
  fp.national_id,
  fp.economic_code,
  fp.credit_limit,
  fp.opening_balance,
  fp.is_active,
  fp.notes,
  fp.created_at,
  fp.updated_at
from public.finance_parties fp
where fp.party_type::text = 'customer'
   or fp.linked_customer_id is not null
order by fp.display_name, fp.id;

-- 3) کنترل سریع تعداد رکوردها؛ اختیاری
select
  (select count(*) from public.customers) as customers_count,
  (select count(*) from public.finance_parties where party_type::text = 'customer') as customer_finance_parties_count,
  (select count(*) from public.finance_parties where linked_customer_id is not null) as linked_finance_parties_count;
