const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import(`./config.js${new URL(import.meta.url).search}`);

export const isDemo = !SUPABASE_URL || !SUPABASE_ANON_KEY;

function friendlyError(error) {
  const msg = error?.message || String(error);
  if (/Invalid login credentials/i.test(msg)) return 'Email o contraseña incorrectos.';
  if (/Email not confirmed/i.test(msg)) return 'Falta confirmar el email (revisá tu correo).';
  if (/Database error saving new user|Solo se permiten dos usuarios/i.test(msg)) return 'Ya hay dos usuarios registrados en esta app.';
  if (/already registered/i.test(msg)) return 'Ese email ya está registrado. Iniciá sesión.';
  if (/Password should be/i.test(msg)) return 'La contraseña debe tener al menos 6 caracteres.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Sin conexión. Probá de nuevo en un rato.';
  return msg;
}

async function run(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(friendlyError(error));
  return data;
}

function createSupabaseStore(createClient) {
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  // Supabase devuelve como máximo 1000 filas por consulta: se pide de a páginas.
  async function fetchAll(table) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const page = await run(db.from(table).select('*')
        .order('date', { ascending: false }).order('created_at', { ascending: false }).order('id')
        .range(from, from + 999));
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  }
  return {
    async currentUserId() {
      const { data } = await db.auth.getSession();
      return data.session?.user?.id ?? null;
    },
    onAuthChange(cb) {
      db.auth.onAuthStateChange((_event, session) => cb(session?.user?.id ?? null));
    },
    async signIn(email, password) {
      await run(db.auth.signInWithPassword({ email, password }));
    },
    async signUp(email, password, name) {
      const data = await run(db.auth.signUp({ email, password, options: { data: { name } } }));
      if (data.session) return { needsConfirmation: false };
      const { error } = await db.auth.signInWithPassword({ email, password });
      return { needsConfirmation: !!error };
    },
    async signOut() {
      await db.auth.signOut();
    },
    async loadAll() {
      const [profiles, expenses, settlements] = await Promise.all([
        run(db.from('profiles').select('*').order('created_at')),
        fetchAll('expenses'),
        fetchAll('settlements'),
      ]);
      return { profiles, expenses, settlements };
    },
    async saveExpense(e) {
      const row = {
        date: e.date, description: e.description, amount: e.amount,
        category: e.category, paid_by: e.paid_by, payer_share_pct: e.payer_share_pct,
      };
      if (e.id) await run(db.from('expenses').update(row).eq('id', e.id));
      else await run(db.from('expenses').insert(row));
    },
    async deleteExpense(id) {
      await run(db.from('expenses').delete().eq('id', id));
    },
    async saveSettlement(s) {
      const row = { date: s.date, from_user: s.from_user, to_user: s.to_user, amount: s.amount, note: s.note || null };
      if (s.id) await run(db.from('settlements').update(row).eq('id', s.id));
      else await run(db.from('settlements').insert(row));
    },
    async deleteSettlement(id) {
      await run(db.from('settlements').delete().eq('id', id));
    },
    async updateProfile(id, fields) {
      await run(db.from('profiles').update(fields).eq('id', id));
    },
    subscribe(cb) {
      db.channel('cambios')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, cb)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements' }, cb)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, cb)
        .subscribe();
    },
  };
}

const DEMO_KEY = 'gastos-pareja-demo';

function demoSeed() {
  const profiles = [
    { id: 'u1', name: 'Ariel', color: '#4f46e5' },
    { id: 'u2', name: 'Mi señora', color: '#db2777' },
  ];
  const cats = ['supermercado', 'comida', 'servicios', 'transporte', 'casa', 'salud', 'salidas', 'otros'];
  const descs = {
    supermercado: ['Súper Coto', 'Verdulería', 'Carnicería'], comida: ['Delivery pizza', 'Panadería'],
    servicios: ['Luz', 'Internet', 'Gas'], transporte: ['Nafta', 'SUBE'], casa: ['Ferretería', 'Limpieza'],
    salud: ['Farmacia'], salidas: ['Cine', 'Cena afuera'], otros: ['Regalo cumpleaños'],
  };
  const expenses = [];
  const now = new Date();
  let n = 0;
  for (let m = 5; m >= 0; m--) {
    for (let i = 0; i < 9; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1 + ((i * 3 + m) % 27));
      if (d > now) continue;
      const category = cats[(i + m) % cats.length];
      const list = descs[category];
      expenses.push({
        id: 'e' + (++n),
        date: toISODate(d),
        description: list[(i + m) % list.length],
        amount: Math.round((3000 + ((i * 7919 + m * 104729) % 60000)) / 100) * 100,
        category,
        paid_by: (i + m) % 3 === 0 ? 'u2' : 'u1',
        payer_share_pct: i % 7 === 6 ? 0 : 50,
        created_at: d.toISOString(),
      });
    }
  }
  const settlements = [{
    id: 's1', date: toISODate(new Date(now.getFullYear(), now.getMonth() - 2, 28)),
    from_user: 'u2', to_user: 'u1', amount: 40000, note: 'Transferencia', created_at: now.toISOString(),
  }];
  return { profiles, expenses, settlements, me: null };
}

function createDemoStore() {
  let state = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null') || demoSeed();
  const save = () => localStorage.setItem(DEMO_KEY, JSON.stringify(state));
  const id = () => Math.random().toString(36).slice(2, 10);
  let authCb = () => {};
  const sortDesc = (list) => list.sort((a, b) => b.date.localeCompare(a.date) || (b.created_at || '').localeCompare(a.created_at || ''));
  return {
    async currentUserId() { return state.me; },
    onAuthChange(cb) { authCb = cb; },
    async signIn(profileId) { state.me = profileId; save(); authCb(profileId); },
    async signUp() { return { needsConfirmation: false }; },
    async signOut() { state.me = null; save(); authCb(null); },
    async loadAll() {
      const copy = structuredClone(state);
      return { profiles: copy.profiles, expenses: sortDesc(copy.expenses), settlements: sortDesc(copy.settlements) };
    },
    async saveExpense(e) {
      if (e.id) Object.assign(state.expenses.find((x) => x.id === e.id), e);
      else state.expenses.push({ ...e, id: id(), created_at: new Date().toISOString() });
      save();
    },
    async deleteExpense(eid) { state.expenses = state.expenses.filter((x) => x.id !== eid); save(); },
    async saveSettlement(s) {
      if (s.id) Object.assign(state.settlements.find((x) => x.id === s.id), s);
      else state.settlements.push({ ...s, id: id(), created_at: new Date().toISOString() });
      save();
    },
    async deleteSettlement(sid) { state.settlements = state.settlements.filter((x) => x.id !== sid); save(); },
    async updateProfile(pid, fields) { Object.assign(state.profiles.find((p) => p.id === pid), fields); save(); },
    subscribe() {},
    resetDemo() { state = demoSeed(); save(); },
  };
}

export function toISODate(d) {
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function createStore() {
  if (isDemo) return createDemoStore();
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm');
  return createSupabaseStore(createClient);
}
