// Покупки: общий список и по категориям/поводам, со сроком или без.
// Покупка — обычное разовое дело с полем shop (категория). Со сроком — видна в календаре в этот день.
// Покупки из «Планов» (подзадачи с отметкой 🛒) и из праздников показываются здесь же — справочник общий.
import { state, commit } from './core-store.js?v=2.6.3';
import { esc, on, toast, openSheet, closeSheet } from './ui.js?v=2.6.3';
import { today, addDays, fmtDay, diffDays, weekStart } from './core-dates.js?v=2.6.3';
import { addTask, newTask, getTask, deleteTask, parseText } from './tasks-model.js?v=2.6.3';
import { planDate, nextFlagDay } from './core-occur.js?v=2.6.3';
import { occDate } from './holidays-model.js?v=2.6.3';

export const SHOP_CATS = [
  { id: 'market', icon: '📦', name: 'Маркетплейсы', re: /озон|ozon|wb|вайлдбер|wildber|маркет|али|заказ|доставк|пвз|пункт выдачи/i },
  { id: 'food', icon: '🥦', name: 'Продукты', re: /молок|хлеб|сыр|мяс|кур|рыб|овощ|фрукт|яйц|круп|макарон|масл|сахар|чай|кофе|продукт|йогурт|творог|колбас|картош|яблок|банан|вод[аы]\b/i },
  { id: 'beauty', icon: '💄', name: 'Косметика', re: /крем|шампун|бальзам|маск|тушь|помад|космет|гель|лак|духи|парфюм|сыворот|пенк|тоник|скраб/i },
  { id: 'clothes', icon: '👗', name: 'Одежда', re: /плать|брюк|джинс|куртк|кофт|футболк|носк|колгот|обув|ботин|кроссов|сапог|шапк|шарф|перчат|одежд|юбк|рубаш|пижам|купальн/i },
  { id: 'gift', icon: '🎁', name: 'Подарки', re: /подар|сувенир|открытк|букет|цвет[ыо]/i },
  { id: 'dacha', icon: '🏡', name: 'Дача', re: /дач|краск|семен|рассад|удобр|грунт|шланг|саморез|доск|гвозд|инструмент|лопат|теплиц|мангал|уголь|дров/i },
  { id: 'other', icon: '🛒', name: 'Другое', re: /^$/ }
];
export const shopCat = id => SHOP_CATS.find(c => c.id === id) || SHOP_CATS[SHOP_CATS.length - 1];
export const guessShop = s => (SHOP_CATS.find(c => c.id !== 'other' && c.re.test(s)) || SHOP_CATS[SHOP_CATS.length - 1]).id;

const ui = { cat: 'all', q: '', showDone: false };
const CTX_NAMES = { dacha: '🏡 к даче', vac_me: '🏖 к отпуску', vac_h: '🧳 к отпуску мужа', sick: '🤒 на больничный' };

/** Все покупки: свои + подзадачи-покупки из «Планов». */
export function allPurchases() {
  const out = [];
  for (const t of state.tasks) {
    if (t.archived) continue;
    if (t.shop && t.kind === 'once') out.push({ t, title: t.title, cat: t.shop, due: planDate(t), done: !!t.done, link: linkTxt(t) });
    for (const s of t.subs || []) if (s.buy) { const base = planDate(t); out.push({ t, sub: s, title: s.title, cat: s.shop || (t.ctx === 'dacha' ? 'dacha' : 'other'), due: base ? addDays(base, -(+s.before || 0)) : null, done: !!s.done || !!t.done, link: 'для «' + t.title + '»' }); }
  }
  return out;
}
function linkTxt(t) {
  if (t.occ) { const o = (state.meta.occasions || []).find(x => x.id === t.occ); return o ? `${o.icon} ${o.name}` : ''; }
  if (t.bday) { const b = state.birthdays.find(x => x.id === t.bday); return b ? `🎂 ДР ${b.name}` : ''; }
  if (t.ctx && CTX_NAMES[t.ctx]) return CTX_NAMES[t.ctx];
  return '';
}

export function render() {
  const all = allPurchases();
  const q = ui.q.toLowerCase().trim();
  const list = all.filter(p => (ui.showDone || !p.done) && (ui.cat === 'all' || (ui.cat === 'nodate' ? !p.due : p.cat === ui.cat)) && (!q || p.title.toLowerCase().includes(q)));
  const t0 = today(), we = addDays(weekStart(t0), 6);
  const grp = [
    ['⚠ Просрочено', p => p.due && p.due < t0],
    ['Сегодня', p => p.due === t0],
    ['На этой неделе', p => p.due && p.due > t0 && p.due <= we],
    ['Позже', p => p.due && p.due > we],
    ['Без срока', p => !p.due]
  ];
  const row = p => { const c = shopCat(p.cat);
    return `<div class="sh-row ${p.done ? 'done' : ''}"><input type="checkbox" class="check" data-act="shDone" data-id="${p.t.id}" data-sub="${p.sub ? p.sub.id : ''}" ${p.done ? 'checked' : ''} aria-label="Куплено"><div class="grow" data-act="shEdit" data-id="${p.t.id}" data-sub="${p.sub ? p.sub.id : ''}"><div class="t">${c.icon} ${esc(p.title)}</div><div class="m">${p.due ? esc(fmtDay(p.due)) : 'без срока'}${p.link ? ' · ' + esc(p.link) : ''}${p.t.note && !p.sub ? ' · ' + esc(p.t.note) : ''}</div></div></div>`; };
  const cnt = id => all.filter(p => !p.done && (id === 'all' || (id === 'nodate' ? !p.due : p.cat === id))).length;
  return `<div class="row between"><h1>Покупки</h1><button class="btn small" data-act="shNew">+ Покупка</button></div>
  <div class="card"><textarea id="sh-in" class="inp" rows="2" placeholder="Молоко; крем для рук; краска для дачи; подарок маме"></textarea>
    <div class="row between" style="flex-wrap:wrap;gap:8px"><span class="hint">Несколько — через «;». Категорию угадаю сама, срок можно назвать: «завтра», «к пятнице».</span><button class="btn" data-act="shAdd">Добавить</button></div></div>
  <div class="hscroll">${[['all', '🧾 Все'], ...SHOP_CATS.map(c => [c.id, c.icon + ' ' + c.name]), ['nodate', '∞ Без срока']].map(([id, n]) => `<button class="chip" data-act="shCat" data-v="${id}" aria-pressed="${ui.cat === id}">${n} <small>${cnt(id)}</small></button>`).join('')}</div>
  <div class="row between"><input id="sh-q" class="inp" type="search" placeholder="Найти" value="${esc(ui.q)}" style="flex:1"><label class="row hint" style="gap:6px;margin-left:8px"><input type="checkbox" data-act="shShowDone" ${ui.showDone ? 'checked' : ''}> купленные</label></div>
  ${grp.map(([h, f]) => { const g = list.filter(f).sort((a, b) => (a.due || '9').localeCompare(b.due || '9')); return g.length ? `<section><h2>${h} <small>${g.length}</small></h2><div class="list sh-list">${g.map(row).join('')}</div></section>` : ''; }).join('') || '<div class="empty">Список пуст. Добавь покупку выше.</div>'}`;
}

on('shCat', d => { ui.cat = d.v; window.app.render(); });
on('shShowDone', (d, el) => { ui.showDone = el.checked; window.app.render(); });
export function onShopInput(e) { if (e.target.id === 'sh-q') { ui.q = e.target.value; window.app.render(); return true; } return false; }
on('shAdd', () => {
  const el = document.getElementById('sh-in'); const txt = el.value.trim(); if (!txt) return el.focus();
  el.value = '';
  const items = [];
  // каждую покупку разбираем отдельно: срок у одной не должен переходить на другие
  for (const seg of txt.split(/[;\n]+/).map(x => x.trim()).filter(Boolean)) {
    const it = parseText(seg)[0]; if (!it) continue;
    const hasDate = /(^|\s)(сегодня|завтра|послезавтра|\d{1,2}[.\/]\d{1,2}|к\s|до\s|в\s(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье))/i.test(seg);
    const shop = ui.cat !== 'all' && ui.cat !== 'nodate' ? ui.cat : guessShop(seg);
    items.push(it);
    addTask(newTask({ title: it.title, kind: 'once', cat: 'shop', shop, date: hasDate ? it.date : '', time: '', dur: 15, ...(shop === 'dacha' && !hasDate ? { ctx: 'dacha' } : {}) }));
  }
  toast(items.length === 1 ? `В покупки: ${items[0].title}` : `Добавлено покупок: ${items.length}`);
});
on('shDone', (d, el) => {
  const t = getTask(d.id); if (!t) return;
  if (d.sub) { const s = (t.subs || []).find(x => x.id === d.sub); if (s) s.done = el.checked; } else t.done = el.checked;
  commit(); if (el.checked) toast('Куплено ✓');
});
on('shNew', () => shopSheet(null));
on('shEdit', d => { const t = getTask(d.id); if (!t) return; if (d.sub) { import('./work-view.js?v=2.6.3').then(w => w.planSheet(t.id)); return; } shopSheet(t); });

/** Карточка покупки: название, категория, срок (дата / к даче / к празднику / без срока), заметка (ссылка, ПВЗ). */
export function shopSheet(t, preset = {}) {
  const x = t || { title: '', shop: preset.shop || (ui.cat !== 'all' && ui.cat !== 'nodate' ? ui.cat : 'other'), date: '', ...preset };
  const occs = state.meta.occasions || [];
  const when = x.date ? 'date' : x.occ ? 'occ:' + x.occ : x.bday ? 'bday:' + x.bday : x.ctx ? 'ctx:' + x.ctx : 'none';
  const sh = openSheet(`<h3>${t ? 'Покупка' : 'Новая покупка'}</h3>
    <label class="field">Что купить<input id="sp-t" value="${esc(x.title)}" placeholder="Например: краска для забора"></label>
    <h2>Категория</h2><div class="chips sm">${SHOP_CATS.map(c => `<button class="chip" data-s="cat" data-v="${c.id}" aria-pressed="${x.shop === c.id}">${c.icon} ${c.name}</button>`).join('')}</div>
    <h2>Срок</h2><label class="field"><select id="sp-when">
      <option value="none" ${when === 'none' ? 'selected' : ''}>Без срока</option>
      <option value="date" ${when === 'date' ? 'selected' : ''}>К дате…</option>
      ${Object.entries(CTX_NAMES).map(([k, n]) => `<option value="ctx:${k}" ${when === 'ctx:' + k ? 'selected' : ''}>${n} (накануне ближайшего дня)</option>`).join('')}
      ${occs.map(o => `<option value="occ:${o.id}" ${when === 'occ:' + o.id ? 'selected' : ''}>${o.icon} ${esc(o.name)} — ${esc(fmtDay(occDate(o)))}</option>`).join('')}
      ${state.birthdays.map(b => `<option value="bday:${b.id}" ${when === 'bday:' + b.id ? 'selected' : ''}>🎂 ДР ${esc(b.name)}</option>`).join('')}
    </select></label>
    <div class="fields"><label class="field">Дата<input type="date" id="sp-d" value="${esc(x.date || '')}"></label><label class="field">За дней до повода<input type="number" id="sp-b" min="0" max="90" value="${+x.before || 0}"></label></div>
    <label class="field">Заметка: ссылка, размер, пункт выдачи<input id="sp-n" value="${esc(x.note || '')}"></label>
    <div class="actions">${t ? '<button class="btn ghost danger" data-s="del">Удалить</button>' : '<span></span>'}<span class="row"><button class="btn ghost" data-s="close">Закрыть</button><button class="btn" data-s="save">Сохранить</button></span></div>`, 'Покупка');
  let cat = x.shop;
  sh.addEventListener('click', e => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    if (b.dataset.s === 'cat') { cat = b.dataset.v; sh.querySelectorAll('[data-s="cat"]').forEach(c => c.setAttribute('aria-pressed', c === b)); return; }
    if (b.dataset.s === 'close') return closeSheet();
    if (b.dataset.s === 'del') { if (b.dataset.sure) { deleteTask(t.id); closeSheet(); toast('Удалено'); } else { b.dataset.sure = 1; b.textContent = 'Точно удалить?'; } return; }
    if (b.dataset.s === 'save') {
      const title = document.getElementById('sp-t').value.trim(); if (!title) return document.getElementById('sp-t').focus();
      const w = document.getElementById('sp-when').value, d = document.getElementById('sp-d').value;
      const rec = { title, shop: cat, cat: 'shop', kind: 'once', time: '', dur: 15, note: document.getElementById('sp-n').value.trim(), before: +document.getElementById('sp-b').value || 0, date: '', ctx: '', occ: '', bday: '' };
      if (w === 'date' || (w === 'none' && d)) rec.date = d || today();
      else if (w.startsWith('ctx:')) rec.ctx = w.slice(4);
      else if (w.startsWith('occ:')) rec.occ = w.slice(4);
      else if (w.startsWith('bday:')) rec.bday = w.slice(5);
      if (t) { Object.assign(t, rec); commit(); } else addTask(newTask(rec));
      closeSheet(); toast('Сохранено');
    }
  });
}
