# زیرساخت مشترک سیستم (Auth + Profiles + Roles)

این بخش پایه‌ی مشترک همه‌ی ماژول‌هاست (R&D، سفارش، انبار، حسابداری، اداری). باید **قبل از هرچیز دیگری** روی Supabase اجرا شود، چون همه‌ی RLS Policy های بقیه‌ی بخش‌ها از تابع `has_role()` که اینجا ساخته می‌شود استفاده خواهند کرد.

فرض: تیم ۴ تا ۱۰ نفره‌ست و ثبت‌نام عمومی نداریم — کاربران را مدیر (از پنل Supabase یا بعداً یک فرم داخلی) می‌سازد، نه با signup باز.

---

## ۱. نقش‌ها (Enum)

```sql
create extension if not exists pgcrypto;

create type app_role as enum (
  'admin', 'rnd_manager', 'sales', 'production_manager', 'warehouse', 'accountant', 'office'
);
```

## ۲. جدول profiles

```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  full_name_en text,
  role app_role not null default 'office',
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.profiles (role);
```

## ۳. ساخت خودکار پروفایل هنگام ساخت کاربر جدید

وقتی مدیر از پنل Supabase (Authentication → Add user) کاربر جدید می‌سازد، می‌تواند در `user_metadata` مقدار `full_name` و `role` را هم بدهد؛ این تریگر خودش پروفایل را می‌سازد:

```sql
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::app_role, 'office')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
```

## ۴. تابع مشترک بررسی نقش (هسته‌ی یکپارچگی همه‌ی ماژول‌ها)

به‌جای این‌که در هر ماژول (R&D، سفارش، انبار، حسابداری) یک `exists (select ... from profiles ...)` جدا بنویسیم، همه از این یک تابع استفاده می‌کنند. یعنی وقتی بعداً نقش جدیدی اضافه شود یا منطق تغییر کند، فقط همین یک‌جا عوض می‌شود:

```sql
create or replace function public.has_role(roles text[])
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role::text = any(roles)
      and is_active
  );
$$ language sql stable security definer;
```

مثال استفاده در هر جدول: `using (public.has_role(array['admin','rnd_manager']))`

## ۵. RLS خود جدول profiles

```sql
alter table public.profiles enable row level security;

create policy profiles_self_or_admin_read on public.profiles
for select using (id = auth.uid() or public.has_role(array['admin']));

create policy profiles_admin_write on public.profiles
for update using (public.has_role(array['admin']));

create policy profiles_admin_insert on public.profiles
for insert with check (public.has_role(array['admin']));
```

## ۶. اصلاح Policy های R&D برای استفاده از تابع مشترک

این جایگزین بخش ۹ سند `rnd-module-design.md` می‌شود (همان منطق قبلی، فقط تمیزتر و یکپارچه):

```sql
drop policy if exists rnd_full_access on public.rnd_projects;
create policy rnd_full_access on public.rnd_projects
for all using (public.has_role(array['admin', 'rnd_manager']));

drop policy if exists rnd_sales_read on public.rnd_projects;
create policy rnd_sales_read on public.rnd_projects
for select using (public.has_role(array['sales']));

drop policy if exists rnd_sales_insert on public.rnd_projects;
create policy rnd_sales_insert on public.rnd_projects
for insert with check (public.has_role(array['sales']));

drop policy if exists rnd_accounting_read on public.rnd_projects;
create policy rnd_accounting_read on public.rnd_projects
for select using (public.has_role(array['accountant']));
```

از این به بعد، هر ماژول جدید (سفارش، انبار، حسابداری) هم دقیقاً همین الگو را برای Policy هایش استفاده می‌کند — فقط `has_role(array[...])` با نقش‌های مرتبط.

## ۷. فرض فنی فرانت‌اند

برای کد سمت React فرض کردم پروژه با **Vite** ساخته می‌شود (رایج‌ترین گزینه برای دیپلوی استاتیک روی Netlify) و متغیرهای محیطی با پیشوند `VITE_` تعریف می‌شوند:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

اگر از Next.js یا CRA استفاده می‌کنی بگو تا نام متغیرها را اصلاح کنم (`NEXT_PUBLIC_...` یا `REACT_APP_...`).
