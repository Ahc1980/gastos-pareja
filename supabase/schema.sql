-- Esquema de la base de datos para "Gastos en pareja" (Supabase / Postgres)
-- Se puede ejecutar varias veces sin romper nada.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  color text not null default '#4f46e5',
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  description text not null,
  amount numeric(14, 2) not null check (amount > 0),
  category text not null default 'otros',
  paid_by uuid not null references public.profiles (id),
  payer_share_pct numeric(5, 2) not null default 50 check (payer_share_pct between 0 and 100),
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);

create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  from_user uuid not null references public.profiles (id),
  to_user uuid not null references public.profiles (id),
  amount numeric(14, 2) not null check (amount > 0),
  note text,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  check (from_user <> to_user)
);

alter table public.expenses add column if not exists subcategory text;

-- Subcategorías agregadas por los usuarios (las de siempre vienen en la app).
create table if not exists public.subcategories (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (category, name)
);

create index if not exists expenses_date_idx on public.expenses (date desc);
create index if not exists settlements_date_idx on public.settlements (date desc);

grant usage on schema public to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.expenses, public.settlements, public.subcategories to authenticated;

-- Solo los integrantes (máximo 2) pueden ver y editar datos.
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;

-- Al registrarse un usuario se crea su perfil. Si ya hay 2, se rechaza el registro.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member_count int;
begin
  select count(*) into member_count from public.profiles;
  if member_count >= 2 then
    raise exception 'Solo se permiten dos usuarios';
  end if;
  insert into public.profiles (id, name, color)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
    case when member_count = 0 then '#4f46e5' else '#db2777' end
  );
  return new;
end;
$$;

-- Confirma el email automáticamente (la app es privada y limitada a dos usuarios).
create or replace function public.auto_confirm_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end;
$$;

drop trigger if exists before_auth_user_created on auth.users;
create trigger before_auth_user_created
  before insert on auth.users
  for each row execute function public.auto_confirm_user();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.expenses enable row level security;
alter table public.settlements enable row level security;
alter table public.subcategories enable row level security;

drop policy if exists "members read profiles" on public.profiles;
create policy "members read profiles" on public.profiles
  for select to authenticated using (public.is_member());

drop policy if exists "members update own profile" on public.profiles;
create policy "members update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "members all expenses" on public.expenses;
create policy "members all expenses" on public.expenses
  for all to authenticated using (public.is_member()) with check (public.is_member());

drop policy if exists "members all settlements" on public.settlements;
create policy "members all settlements" on public.settlements
  for all to authenticated using (public.is_member()) with check (public.is_member());

drop policy if exists "members all subcategories" on public.subcategories;
create policy "members all subcategories" on public.subcategories
  for all to authenticated using (public.is_member()) with check (public.is_member());

-- Actualización en tiempo real (lo que carga uno lo ve el otro al instante)
do $$
begin
  begin
    alter publication supabase_realtime add table public.expenses;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.settlements;
  exception when duplicate_object then null;
  end;
end;
$$;
