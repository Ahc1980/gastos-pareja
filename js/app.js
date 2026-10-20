const { createStore, isDemo, toISODate } = await import(`./store.js${new URL(import.meta.url).search}`);

const CATEGORIES = [
  { id: 'supermercado', label: 'Súper', emoji: '🛒', color: '#10b981' },
  { id: 'comida', label: 'Comida', emoji: '🍕', color: '#f59e0b' },
  { id: 'servicios', label: 'Servicios', emoji: '💡', color: '#3b82f6' },
  { id: 'casa', label: 'Casa', emoji: '🏠', color: '#8b5cf6' },
  { id: 'transporte', label: 'Transporte', emoji: '🚗', color: '#06b6d4' },
  { id: 'salud', label: 'Salud', emoji: '💊', color: '#ef4444' },
  { id: 'salidas', label: 'Salidas', emoji: '🎉', color: '#ec4899' },
  { id: 'chicos', label: 'Chicos', emoji: '🧸', color: '#f97316' },
  { id: 'mascotas', label: 'Mascotas', emoji: '🐶', color: '#a16207' },
  { id: 'ropa', label: 'Ropa', emoji: '👕', color: '#6366f1' },
  { id: 'otros', label: 'Otros', emoji: '📦', color: '#64748b' },
];
const catById = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmt = (n) => money.format(Math.round(n * 100) / 100);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const monthKey = (d) => d.slice(0, 7);
const parseDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const monthName = (key) => {
  const [y, m] = key.split('-').map(Number);
  const name = new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long' });
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
};
const shortMonth = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'short' }).replace('.', ''); };
const shiftMonth = (key, delta) => { const [y, m] = key.split('-').map(Number); return toISODate(new Date(y, m - 1 + delta, 1)).slice(0, 7); };
const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();

function dayLabel(iso) {
  const today = toISODate(new Date());
  const yesterday = toISODate(new Date(Date.now() - 864e5));
  if (iso === today) return 'Hoy';
  if (iso === yesterday) return 'Ayer';
  return parseDate(iso).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
}

const state = {
  store: null,
  me: null,
  profiles: [],
  expenses: [],
  settlements: [],
  tab: 'inicio',
  month: toISODate(new Date()).slice(0, 7),
  search: '',
  charts: [],
};

const $app = document.getElementById('app');
const $modal = document.getElementById('modal-root');

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2200);
}

const profile = (id) => state.profiles.find((p) => p.id === id) || { id, name: '?', color: '#9ca3af' };
const other = (id) => state.profiles.find((p) => p.id !== id) || { id: null, name: 'el otro', color: '#9ca3af' };
const avatar = (p, cls = '') => `<span class="avatar ${cls}" style="background:${esc(p.color)}">${esc(initial(p.name))}</span>`;

// ---------- Cálculos ----------

const owedToPayer = (e) => Number(e.amount) * (100 - Number(e.payer_share_pct)) / 100;

function computeBalance() {
  const net = Object.fromEntries(state.profiles.map((p) => [p.id, 0]));
  for (const e of state.expenses) {
    const o = other(e.paid_by).id;
    const owed = owedToPayer(e);
    net[e.paid_by] = (net[e.paid_by] || 0) + owed;
    if (o) net[o] = (net[o] || 0) - owed;
  }
  for (const s of state.settlements) {
    net[s.from_user] = (net[s.from_user] || 0) + Number(s.amount);
    net[s.to_user] = (net[s.to_user] || 0) - Number(s.amount);
  }
  const [a, b] = state.profiles;
  if (!a || !b) return { amount: 0 };
  const v = Math.round(net[a.id] * 100) / 100;
  if (Math.abs(v) < 0.01) return { amount: 0 };
  return v > 0 ? { amount: v, debtor: b, creditor: a } : { amount: -v, debtor: a, creditor: b };
}

function monthStats(key) {
  const list = state.expenses.filter((e) => monthKey(e.date) === key);
  const paid = Object.fromEntries(state.profiles.map((p) => [p.id, 0]));
  const consumed = Object.fromEntries(state.profiles.map((p) => [p.id, 0]));
  const byCat = {};
  let total = 0;
  for (const e of list) {
    const amt = Number(e.amount);
    total += amt;
    paid[e.paid_by] = (paid[e.paid_by] || 0) + amt;
    const payerPart = amt * Number(e.payer_share_pct) / 100;
    consumed[e.paid_by] = (consumed[e.paid_by] || 0) + payerPart;
    const o = other(e.paid_by).id;
    if (o) consumed[o] = (consumed[o] || 0) + (amt - payerPart);
    byCat[e.category] = (byCat[e.category] || 0) + amt;
  }
  return { list, total, paid, consumed, byCat };
}

function splitText(e) {
  const pct = Number(e.payer_share_pct);
  const o = other(e.paid_by);
  if (pct === 50) return 'Mitad y mitad';
  if (pct === 0) return `Todo de ${o.name}`;
  if (pct === 100) return 'Gasto personal';
  return `${profile(e.paid_by).name} ${pct}% · ${o.name} ${100 - pct}%`;
}

// ---------- Carga ----------

async function reload() {
  try {
    const data = await state.store.loadAll();
    Object.assign(state, data);
  } catch (err) {
    toast(err.message);
  }
  render();
}

async function init() {
  try {
    state.store = await createStore();
  } catch (err) {
    $app.innerHTML = `<div class="login"><div class="error">No se pudo iniciar la app: ${esc(err.message)}</div></div>`;
    return;
  }
  state.store.onAuthChange(async (uid) => {
    if (uid === state.me) return;
    state.me = uid;
    if (uid) await reload(); else renderLogin();
  });
  state.me = await state.store.currentUserId();
  if (state.me) {
    state.store.subscribe(() => reload());
    await reload();
  } else {
    renderLogin();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.me) reload(); });
}

// ---------- Login ----------

async function renderLogin(mode = 'login', message = '') {
  destroyCharts();
  if (isDemo) {
    const { profiles } = await state.store.loadAll();
    $app.innerHTML = `
      <div class="login">
        <img class="logo" src="icon.svg" alt="">
        <h1>Gastos en pareja</h1>
        <p class="sub">Modo demo: elegí con quién entrar</p>
        <div class="who-btns">
          ${profiles.map((p) => `<button class="btn" data-demo-login="${esc(p.id)}">${avatar(p, 'sm')} ${esc(p.name)}</button>`).join('')}
        </div>
        <p class="hint" style="text-align:center;margin-top:20px">Los datos de la demo se guardan solo en este navegador.</p>
      </div>`;
    $app.querySelectorAll('[data-demo-login]').forEach((b) => b.addEventListener('click', () => state.store.signIn(b.dataset.demoLogin)));
    return;
  }
  const signup = mode === 'signup';
  $app.innerHTML = `
    <div class="login">
      <img class="logo" src="icon.svg" alt="">
      <h1>Gastos en pareja</h1>
      <p class="sub">${signup ? 'Creá tu cuenta' : 'Ingresá para ver los gastos'}</p>
      ${message}
      <form id="auth-form">
        ${signup ? `<div class="field"><label>Tu nombre</label><input name="name" required autocomplete="given-name" placeholder="Ej: Ariel"></div>` : ''}
        <div class="field"><label>Email</label><input name="email" type="email" required autocomplete="email"></div>
        <div class="field"><label>Contraseña</label><input name="password" type="password" required minlength="6" autocomplete="${signup ? 'new-password' : 'current-password'}"></div>
        <div id="auth-error"></div>
        <button class="btn block" type="submit">${signup ? 'Crear cuenta' : 'Ingresar'}</button>
      </form>
      <p style="text-align:center;margin-top:18px">
        <button class="link" id="switch-mode">${signup ? 'Ya tengo cuenta, ingresar' : 'Crear una cuenta nueva'}</button>
      </p>
    </div>`;
  document.getElementById('switch-mode').onclick = () => renderLogin(signup ? 'login' : 'signup');
  document.getElementById('auth-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const btn = ev.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      if (signup) {
        const { needsConfirmation } = await state.store.signUp(f.get('email').trim(), f.get('password'), f.get('name').trim());
        if (needsConfirmation) renderLogin('login', '<div class="ok">¡Listo! Te mandamos un email para confirmar la cuenta. Después ingresá acá.</div>');
      } else {
        await state.store.signIn(f.get('email').trim(), f.get('password'));
      }
      if (!state.me) state.store.subscribe(() => reload());
    } catch (err) {
      document.getElementById('auth-error').innerHTML = `<div class="error">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
  };
}

// ---------- App ----------

function render() {
  if (!state.me) return renderLogin();
  if (state.profiles.length && !state.profiles.some((p) => p.id === state.me)) {
    $app.innerHTML = `<div class="login"><div class="error">Tu usuario no tiene acceso a estos gastos (la app es para dos personas).</div>
      <button class="btn block" id="logout">Salir</button></div>`;
    document.getElementById('logout').onclick = () => state.store.signOut();
    return;
  }
  destroyCharts();
  const me = profile(state.me);
  $app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div><h1>Gastos en pareja</h1><div class="who">Hola, ${esc(me.name)}</div></div>
        <button class="icon-btn" data-action="settings" aria-label="Ajustes">⚙️</button>
      </header>
      ${isDemo ? `<div class="demo-banner">Modo demo: los datos son de ejemplo y quedan solo en este navegador. <button data-action="reset-demo">Reiniciar demo</button></div>` : ''}
      <main>${state.tab === 'inicio' ? viewHome() : state.tab === 'movimientos' ? viewMovements() : viewCharts()}</main>
      <button class="fab" data-action="new-expense" aria-label="Agregar gasto">+</button>
      <nav class="bottom-nav">
        ${[['inicio', '🏠', 'Inicio'], ['movimientos', '📋', 'Movimientos'], ['graficos', '📊', 'Gráficos']].map(([id, ic, label]) =>
          `<button class="${state.tab === id ? 'active' : ''}" data-tab="${id}"><span class="ic">${ic}</span>${label}</button>`).join('')}
      </nav>
    </div>`;
  if (state.tab === 'graficos') drawCharts();
}

function viewBalance() {
  const b = computeBalance();
  if (!b.amount) {
    return `<section class="card balance even">
      <div class="avatars">${state.profiles.map((p) => avatar(p)).join('<span class="arrow">🤝</span>')}</div>
      <div class="label">Saldo entre ustedes</div>
      <div class="amount">Están a mano</div>
      <div class="detail muted">Nadie le debe nada a nadie</div>
    </section>`;
  }
  const iOwe = b.debtor.id === state.me;
  return `<section class="card balance">
    <div class="avatars">${avatar(b.debtor)}<span class="arrow">➜</span>${avatar(b.creditor)}</div>
    <div class="label">${iOwe ? 'Vos le debés' : `${esc(b.debtor.name)} te debe`}</div>
    <div class="amount ${iOwe ? 'neg' : 'pos'}">${fmt(b.amount)}</div>
    <div class="detail muted">${esc(b.debtor.name)} le debe a ${esc(b.creditor.name)}</div>
    <div class="btn-row"><button class="btn secondary" data-action="settle">💸 Saldar deuda</button></div>
  </section>`;
}

function viewHome() {
  const current = toISODate(new Date()).slice(0, 7);
  const recent = mergedMovements().slice(0, 6);
  return `
    ${viewBalance()}
    <section class="card">
      <div class="card-head"><h2>Este mes · ${esc(monthName(current))}</h2></div>
      ${statsGrid(monthStats(current))}
    </section>
    <section class="card">
      <div class="card-head"><h2>Últimos movimientos</h2><button class="link" data-tab="movimientos">Ver todos</button></div>
      ${recent.length ? `<div class="list">${recent.map(itemHtml).join('')}</div>` : emptyHtml()}
    </section>`;
}

function statsGrid(s) {
  return `<div class="stats">
    <div class="stat"><div class="k">Total gastado</div><div class="v">${fmt(s.total)}</div></div>
    ${state.profiles.map((p) => `<div class="stat"><div class="k">Pagó ${esc(p.name)}</div><div class="v" style="color:${esc(p.color)}">${fmt(s.paid[p.id] || 0)}</div></div>`).join('')}
  </div>`;
}

function emptyHtml() {
  return `<div class="empty">Todavía no hay gastos.<br><br><button class="btn" data-action="new-expense">+ Agregar el primero</button></div>`;
}

function mergedMovements(filterMonth) {
  const ex = state.expenses.map((e) => ({ kind: 'expense', ...e }));
  const st = state.settlements.map((s) => ({ kind: 'settlement', ...s }));
  return [...ex, ...st]
    .filter((m) => !filterMonth || monthKey(m.date) === filterMonth)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.created_at || '').localeCompare(a.created_at || ''));
}

function itemHtml(m) {
  if (m.kind === 'settlement') {
    const from = profile(m.from_user);
    const to = profile(m.to_user);
    return `<button class="item" data-edit-settlement="${esc(m.id)}">
      <span class="emoji" style="background:#d1fae5">💸</span>
      <span class="main"><div class="title">${esc(from.name)} le pagó a ${esc(to.name)}</div>
        <div class="sub">${esc(m.note || 'Pago de deuda')}</div></span>
      <span class="right"><div class="total pos">${fmt(m.amount)}</div></span>
    </button>`;
  }
  const c = catById(m.category);
  const payer = profile(m.paid_by);
  const owed = owedToPayer(m);
  let effect = '<span class="muted">No afecta el saldo</span>';
  if (owed > 0) {
    effect = m.paid_by === state.me
      ? `<span class="pos">Te deben ${fmt(owed)}</span>`
      : `<span class="neg">Debés ${fmt(owed)}</span>`;
  }
  return `<button class="item" data-edit-expense="${esc(m.id)}">
    <span class="emoji" style="background:${c.color}22">${c.emoji}</span>
    <span class="main"><div class="title">${esc(m.description)}</div>
      <div class="sub">Pagó ${esc(payer.name)} · ${esc(splitText(m))}</div></span>
    <span class="right"><div class="total">${fmt(m.amount)}</div><div class="effect">${effect}</div></span>
  </button>`;
}

function monthNav() {
  const isCurrent = state.month >= toISODate(new Date()).slice(0, 7);
  return `<div class="month-nav card" style="padding:10px 12px">
    <button data-month="-1" aria-label="Mes anterior">‹</button>
    <span class="name">${esc(monthName(state.month))}</span>
    <button data-month="1" aria-label="Mes siguiente" ${isCurrent ? 'disabled style="opacity:.35"' : ''}>›</button>
  </div>`;
}

function viewMovements() {
  const q = state.search.trim().toLowerCase();
  let list = mergedMovements(state.month);
  if (q) {
    list = list.filter((m) => {
      const text = m.kind === 'expense'
        ? `${m.description} ${catById(m.category).label} ${profile(m.paid_by).name}`
        : `${m.note || ''} pago ${profile(m.from_user).name} ${profile(m.to_user).name}`;
      return text.toLowerCase().includes(q);
    });
  }
  let html = '';
  let lastDay = '';
  for (const m of list) {
    if (m.date !== lastDay) { html += `<div class="day">${esc(dayLabel(m.date))}</div>`; lastDay = m.date; }
    html += itemHtml(m);
  }
  const s = monthStats(state.month);
  return `
    ${monthNav()}
    <input class="search" id="search" placeholder="🔎 Buscar gasto…" value="${esc(state.search)}">
    <section class="card">
      ${statsGrid(s)}
    </section>
    <section class="card">
      ${list.length ? `<div class="list">${html}</div>` : `<div class="empty">${q ? 'No hay resultados.' : 'No hay movimientos este mes.'}</div>`}
    </section>`;
}

function viewCharts() {
  const s = monthStats(state.month);
  const cats = Object.entries(s.byCat).sort((a, b) => b[1] - a[1]);
  return `
    ${monthNav()}
    <section class="card">
      <h2>Gastos por categoría</h2>
      ${s.total ? `<div class="chart-box"><canvas id="ch-cat"></canvas></div>
        <div class="cat-rows">${cats.map(([id, v]) => {
          const c = catById(id);
          const pct = Math.round((v / s.total) * 100);
          return `<div class="cat-row"><div class="top"><span>${c.emoji} ${esc(c.label)}</span><span><b>${fmt(v)}</b> <span class="muted">${pct}%</span></span></div>
            <div class="bar"><span style="width:${pct}%;background:${c.color}"></span></div></div>`;
        }).join('')}</div>` : '<div class="empty">No hay gastos este mes.</div>'}
    </section>
    <section class="card">
      <h2>Quién pagó y cuánto le corresponde a cada uno</h2>
      ${s.total ? `<div class="chart-box"><canvas id="ch-who"></canvas></div>
        <p class="hint">"Pagó" es la plata que puso cada uno. "Le corresponde" es su parte de los gastos según cómo se dividió cada uno.</p>` : '<div class="empty">Sin datos.</div>'}
    </section>
    <section class="card">
      <h2>Últimos 6 meses</h2>
      <div class="chart-box tall"><canvas id="ch-months"></canvas></div>
    </section>`;
}

function destroyCharts() {
  state.charts.forEach((c) => c.destroy());
  state.charts = [];
}

let ChartLib = null;
async function drawCharts() {
  if (!ChartLib) {
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/chart.js@4.5.1/+esm');
      mod.Chart.register(...mod.registerables);
      mod.Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
      ChartLib = mod.Chart;
    } catch {
      toast('No se pudieron cargar los gráficos');
      return;
    }
  }
  if (state.tab !== 'graficos') return;
  destroyCharts();
  const s = monthStats(state.month);
  const moneyTick = (v) => fmt(v);
  const tooltipMoney = { callbacks: { label: (ctx) => ` ${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${fmt(ctx.raw)}` } };

  const catCanvas = document.getElementById('ch-cat');
  if (catCanvas) {
    const cats = Object.entries(s.byCat).sort((a, b) => b[1] - a[1]);
    state.charts.push(new ChartLib(catCanvas, {
      type: 'doughnut',
      data: {
        labels: cats.map(([id]) => `${catById(id).emoji} ${catById(id).label}`),
        datasets: [{ data: cats.map(([, v]) => v), backgroundColor: cats.map(([id]) => catById(id).color), borderWidth: 2, borderColor: '#fff' }],
      },
      options: {
        maintainAspectRatio: false, cutout: '62%',
        plugins: { legend: { position: 'right', labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: (ctx) => ` ${fmt(ctx.raw)}` } } },
      },
    }));
  }

  const whoCanvas = document.getElementById('ch-who');
  if (whoCanvas) {
    state.charts.push(new ChartLib(whoCanvas, {
      type: 'bar',
      data: {
        labels: state.profiles.map((p) => p.name),
        datasets: [
          { label: 'Pagó', data: state.profiles.map((p) => s.paid[p.id] || 0), backgroundColor: state.profiles.map((p) => p.color), borderRadius: 8 },
          { label: 'Le corresponde', data: state.profiles.map((p) => s.consumed[p.id] || 0), backgroundColor: state.profiles.map((p) => p.color + '66'), borderRadius: 8 },
        ],
      },
      options: {
        maintainAspectRatio: false, indexAxis: 'y',
        scales: { x: { ticks: { callback: moneyTick } } },
        plugins: { tooltip: tooltipMoney, legend: { labels: { boxWidth: 12 } } },
      },
    }));
  }

  const monthsCanvas = document.getElementById('ch-months');
  if (monthsCanvas) {
    const keys = [5, 4, 3, 2, 1, 0].map((i) => shiftMonth(state.month, -i));
    const stats = keys.map(monthStats);
    state.charts.push(new ChartLib(monthsCanvas, {
      type: 'bar',
      data: {
        labels: keys.map(shortMonth),
        datasets: state.profiles.map((p) => ({
          label: `Pagó ${p.name}`, data: stats.map((x) => x.paid[p.id] || 0), backgroundColor: p.color, borderRadius: 6, stack: 'pagos',
        })),
      },
      options: {
        maintainAspectRatio: false,
        scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: moneyTick } } },
        plugins: {
          tooltip: { ...tooltipMoney, callbacks: { ...tooltipMoney.callbacks, footer: (items) => `Total: ${fmt(stats[items[0].dataIndex].total)}` } },
          legend: { labels: { boxWidth: 12 } },
        },
      },
    }));
  }
}

// ---------- Modales ----------

function openModal(html, onMount) {
  $modal.innerHTML = `<div class="overlay"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  const overlay = $modal.querySelector('.overlay');
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeModal(); });
  overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
  onMount?.(overlay);
}
function closeModal() { $modal.innerHTML = ''; }

function seg(name, options, value) {
  return `<div class="seg" data-seg="${name}">${options.map(([v, label]) =>
    `<button type="button" data-value="${esc(v)}" class="${String(v) === String(value) ? 'on' : ''}">${esc(label)}</button>`).join('')}</div>`;
}
function bindSeg(root, name, onChange) {
  const box = root.querySelector(`[data-seg="${name}"]`);
  box.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    onChange(b.dataset.value);
  });
}

function openExpense(existing) {
  const e = existing ? { ...existing } : {
    date: toISODate(new Date()), description: '', amount: '', category: 'supermercado', paid_by: state.me, payer_share_pct: 50,
  };
  e.payer_share_pct = Number(e.payer_share_pct);
  const splitMode = () => ([50, 0, 100].includes(e.payer_share_pct) ? String(e.payer_share_pct) : 'custom');

  const splitOptions = () => {
    const o = other(e.paid_by);
    return [['50', 'Mitad y mitad'], ['0', `Todo lo debe ${o.name}`], ['100', 'Gasto personal'], ['custom', 'Otro %']];
  };

  openModal(`
    <h2>${existing ? 'Editar gasto' : 'Nuevo gasto'} <button data-close aria-label="Cerrar">✕</button></h2>
    <form id="exp-form">
      <div class="field"><input class="amount-input" name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" required placeholder="$ 0" value="${esc(e.amount)}"></div>
      <div class="field"><label>Descripción</label><input name="description" required maxlength="80" placeholder="Ej: Supermercado" value="${esc(e.description)}"></div>
      <div class="field"><label>Categoría</label>
        <div class="chips" id="cats">${CATEGORIES.map((c) => `<button type="button" class="chip ${c.id === e.category ? 'on' : ''}" data-cat="${c.id}"><span class="e">${c.emoji}</span>${esc(c.label)}</button>`).join('')}</div>
      </div>
      <div class="trend" id="cat-trend"></div>
      <div class="field"><label>¿Quién pagó?</label>${seg('paid_by', state.profiles.map((p) => [p.id, p.id === state.me ? `${p.name} (yo)` : p.name]), e.paid_by)}</div>
      <div class="field"><label>¿Cómo se divide?</label><div id="split-box"></div>
        <div id="custom-box" style="margin-top:10px"></div>
        <div class="hint" id="split-hint"></div>
      </div>
      <div class="field"><label>Fecha</label><input name="date" type="date" required value="${esc(e.date)}"></div>
      <div id="exp-error"></div>
      <button class="btn block" type="submit">${existing ? 'Guardar cambios' : 'Agregar gasto'}</button>
      ${existing ? '<div class="btn-row"><button type="button" class="btn danger" id="del-exp">🗑️ Eliminar gasto</button></div>' : ''}
    </form>`, (root) => {
    const form = root.querySelector('#exp-form');
    const amountInput = form.elements.amount;
    if (!existing) setTimeout(() => amountInput.focus(), 50);

    const updateHint = () => {
      const amt = Number(amountInput.value) || 0;
      const payer = profile(e.paid_by);
      const o = other(e.paid_by);
      const owed = amt * (100 - e.payer_share_pct) / 100;
      root.querySelector('#split-hint').textContent = owed > 0
        ? `${o.name} le va a deber ${fmt(owed)} a ${payer.name}.`
        : `No cambia el saldo entre ustedes (solo cuenta en los gráficos).`;
    };
    const renderCustom = () => {
      const box = root.querySelector('#custom-box');
      if (splitMode() !== 'custom') { box.innerHTML = ''; return; }
      const payer = profile(e.paid_by);
      const o = other(e.paid_by);
      box.innerHTML = `<input type="range" min="0" max="100" step="5" value="${e.payer_share_pct}" id="pct">
        <div class="hint" id="pct-label"></div>`;
      const label = () => { box.querySelector('#pct-label').textContent = `${payer.name}: ${e.payer_share_pct}% · ${o.name}: ${100 - e.payer_share_pct}%`; };
      label();
      box.querySelector('#pct').addEventListener('input', (ev) => { e.payer_share_pct = Number(ev.target.value); label(); updateHint(); });
    };
    const renderSplit = () => {
      const current = splitMode();
      root.querySelector('#split-box').innerHTML = seg('split', splitOptions(), current);
      bindSeg(root, 'split', (v) => {
        e.payer_share_pct = v === 'custom' ? (splitMode() === 'custom' ? e.payer_share_pct : 60) : Number(v);
        if (v === 'custom' && [50, 0, 100].includes(e.payer_share_pct)) e.payer_share_pct = 60;
        renderCustom();
        updateHint();
      });
      renderCustom();
      updateHint();
    };
    const renderTrend = () => {
      const end = monthKey(form.elements.date.value || toISODate(new Date()));
      const keys = [2, 1, 0].map((i) => shiftMonth(end, -i));
      const totals = keys.map((k) => state.expenses
        .filter((x) => x.category === e.category && monthKey(x.date) === k)
        .reduce((sum, x) => sum + Number(x.amount), 0));
      const max = Math.max(...totals, 1);
      const cat = catById(e.category);
      root.querySelector('#cat-trend').innerHTML = `<div class="trend-title">Gasto en ${cat.emoji} ${esc(cat.label)} · últimos 3 meses</div>
        ${keys.map((k, i) => `<div class="trend-row"><span class="m">${shortMonth(k)}</span>
          <span class="bar"><span style="width:${(totals[i] / max) * 100}%;background:${cat.color}"></span></span>
          <span class="v">${fmt(totals[i])}</span></div>`).join('')}`;
    };
    renderTrend();
    form.elements.date.addEventListener('change', renderTrend);
    renderSplit();
    bindSeg(root, 'paid_by', (v) => { e.paid_by = v; renderSplit(); });
    amountInput.addEventListener('input', updateHint);
    root.querySelector('#cats').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-cat]');
      if (!b) return;
      e.category = b.dataset.cat;
      root.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x === b));
      renderTrend();
    });
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await state.store.saveExpense({
          ...(existing ? { id: existing.id } : {}),
          date: form.elements.date.value,
          description: form.elements.description.value.trim(),
          amount: Math.round(Number(amountInput.value) * 100) / 100,
          category: e.category,
          paid_by: e.paid_by,
          payer_share_pct: e.payer_share_pct,
        });
        closeModal();
        toast(existing ? 'Gasto actualizado' : 'Gasto agregado');
        await reload();
      } catch (err) {
        root.querySelector('#exp-error').innerHTML = `<div class="error">${esc(err.message)}</div>`;
        btn.disabled = false;
      }
    };
    root.querySelector('#del-exp')?.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este gasto?')) return;
      try {
        await state.store.deleteExpense(existing.id);
        closeModal();
        toast('Gasto eliminado');
        await reload();
      } catch (err) { toast(err.message); }
    });
  });
}

function openSettlement(existing) {
  const b = computeBalance();
  const s = existing ? { ...existing } : {
    date: toISODate(new Date()),
    from_user: b.debtor?.id || state.me,
    to_user: b.creditor?.id || other(state.me).id,
    amount: b.amount || '',
    note: '',
  };
  openModal(`
    <h2>${existing ? 'Editar pago' : 'Saldar deuda'} <button data-close aria-label="Cerrar">✕</button></h2>
    <form id="set-form">
      <div class="field"><label>¿Quién paga?</label>${seg('from', state.profiles.map((p) => [p.id, p.name]), s.from_user)}</div>
      <div class="hint" id="to-label" style="margin:-6px 0 14px"></div>
      <div class="field"><label>Monto</label><input class="amount-input" name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" required value="${esc(s.amount)}"></div>
      <div class="field"><label>Nota (opcional)</label><input name="note" maxlength="80" placeholder="Ej: Transferencia" value="${esc(s.note || '')}"></div>
      <div class="field"><label>Fecha</label><input name="date" type="date" required value="${esc(s.date)}"></div>
      <div id="set-error"></div>
      <button class="btn block" type="submit">${existing ? 'Guardar cambios' : 'Registrar pago'}</button>
      ${existing ? '<div class="btn-row"><button type="button" class="btn danger" id="del-set">🗑️ Eliminar pago</button></div>' : ''}
    </form>`, (root) => {
    const toLabel = () => { root.querySelector('#to-label').textContent = `Le paga a ${other(s.from_user).name}`; };
    toLabel();
    bindSeg(root, 'from', (v) => { s.from_user = v; s.to_user = other(v).id; toLabel(); });
    const form = root.querySelector('#set-form');
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await state.store.saveSettlement({
          ...(existing ? { id: existing.id } : {}),
          date: form.elements.date.value,
          from_user: s.from_user,
          to_user: other(s.from_user).id,
          amount: Math.round(Number(form.elements.amount.value) * 100) / 100,
          note: form.elements.note.value.trim(),
        });
        closeModal();
        toast('Pago registrado');
        await reload();
      } catch (err) {
        root.querySelector('#set-error').innerHTML = `<div class="error">${esc(err.message)}</div>`;
        btn.disabled = false;
      }
    };
    root.querySelector('#del-set')?.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este pago?')) return;
      try {
        await state.store.deleteSettlement(existing.id);
        closeModal();
        toast('Pago eliminado');
        await reload();
      } catch (err) { toast(err.message); }
    });
  });
}

function openSettings() {
  const me = profile(state.me);
  const colors = ['#4f46e5', '#db2777', '#059669', '#ea580c', '#0891b2', '#7c3aed', '#ca8a04', '#475569'];
  let color = me.color;
  openModal(`
    <h2>Ajustes <button data-close aria-label="Cerrar">✕</button></h2>
    <form id="set-profile">
      <div class="field"><label>Tu nombre</label><input name="name" required maxlength="30" value="${esc(me.name)}"></div>
      <div class="field"><label>Tu color</label>
        <div class="chips" id="colors" style="grid-template-columns:repeat(8,1fr)">${colors.map((c) =>
          `<button type="button" class="chip ${c === color ? 'on' : ''}" data-color="${c}" style="padding:6px"><span class="avatar sm" style="background:${c}"></span></button>`).join('')}</div>
      </div>
      <button class="btn block" type="submit">Guardar</button>
    </form>
    <div class="btn-row"><button class="btn ghost" id="logout">Cerrar sesión</button></div>`, (root) => {
    root.querySelector('#colors').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-color]');
      if (!b) return;
      color = b.dataset.color;
      root.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
    });
    root.querySelector('#set-profile').onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        await state.store.updateProfile(state.me, { name: ev.target.elements.name.value.trim(), color });
        closeModal();
        toast('Guardado');
        await reload();
      } catch (err) { toast(err.message); }
    };
    root.querySelector('#logout').onclick = async () => { closeModal(); await state.store.signOut(); };
  });
}

// ---------- Eventos ----------

document.addEventListener('click', (ev) => {
  if (!$app.contains(ev.target)) return;
  const t = ev.target.closest('[data-tab],[data-action],[data-month],[data-edit-expense],[data-edit-settlement]');
  if (!t) return;
  if (t.dataset.tab) { state.tab = t.dataset.tab; render(); window.scrollTo(0, 0); return; }
  if (t.dataset.month) { state.month = shiftMonth(state.month, Number(t.dataset.month)); render(); return; }
  if (t.dataset.editExpense) { openExpense(state.expenses.find((x) => x.id === t.dataset.editExpense)); return; }
  if (t.dataset.editSettlement) { openSettlement(state.settlements.find((x) => x.id === t.dataset.editSettlement)); return; }
  const action = t.dataset.action;
  if (action === 'new-expense') openExpense();
  else if (action === 'settle') openSettlement();
  else if (action === 'settings') openSettings();
  else if (action === 'reset-demo' && confirm('¿Volver a los datos de ejemplo?')) { state.store.resetDemo(); reload(); }
});

document.addEventListener('input', (ev) => {
  if (ev.target.id !== 'search') return;
  state.search = ev.target.value;
  const pos = ev.target.selectionStart;
  render();
  const input = document.getElementById('search');
  input.focus();
  input.setSelectionRange(pos, pos);
});

document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeModal(); });

init();
