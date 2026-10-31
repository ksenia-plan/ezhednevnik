// Праздники и подарки: поводы (Новый год, 8 марта, свои), подготовка к каждому — дела и покупки «за N дней до»,
// подарки ко дням рождения. Ниже — дни рождения (прежняя вкладка).
import { state, commit, uid } from './core-store.js';
import { esc, on, toast, openSheet, closeSheet } from './ui.js';
import { today, addDays, fmtDay, plural, diffDays } from './core-dates.js';
import { addTask, newTask, getTask, deleteTask } from './tasks-model.js';
import { planDate } from './core-occur.js';
import { occDate, NY_TEMPLATE } from './holidays-model.js';
import { nextBirthday } from './birthdays-model.js';
import * as birthdays from './birthdays-view.js';
import { shopCat, shopSheet, SHOP_CATS } from './shop-view.js';

const occs = () => (state.meta.occasions = state.meta.occasions || []);
const itemsOf = o => state.tasks.filter(t => !t.archived && t.occ === o.id && t.kind === 'once');

export function render() {
  const list = occs().map(o => ({ o, d: occDate(o) })).sort((a, b) => a.d.localeCompare(b.d));
  const bd = state.birthdays.map(b => ({ b, n: nextBirthday(b) })).filter(x => x.n.in <= 60).sort((a, b) => a.n.in - b.n.in);
  const card = ({ o, d }) => { const it = itemsOf(o), done = it.filter(t => t.done).length, n = diffDays(today(), d);
    const next = it.filter(t => !t.done).map(t => ({ t, ds: planDate(t) })).sort((a, b) => (a.ds || '9').localeCompare(b.ds || '9'))[0];
    return `<div class="card occ" data-act="occOpen" data-id="${o.id}" style="cursor:pointer;gap:6px"><div class="row between"><b>${o.icon || '🎉'} ${esc(o.name)}</b><span class="hint">${esc(fmtDay(d))} · ${n === 0 ? 'сегодня' : 'через ' + n + ' ' + plural(n, 'день', 'дня', 'дней')}</span></div>
      ${it.length ? `<div class="bar"><i style="width:${Math.round(done / it.length * 100)}%"></i></div><span class="hint">Готово ${done} из ${it.length}${next ? ` · дальше: ${esc(next.t.shop ? '🛒 ' : '')}${esc(next.t.title)} — ${esc(fmtDay(next.ds))}` : ''}</span>` : `<span class="hint">Подготовка не начата — нажми, чтобы добавить дела и покупки${o.id === 'ny' ? ' или взять готовый список' : ''}.</span>`}</div>`; };
  return `<div class="row between"><h1>Праздники и подарки</h1><button class="btn small" data-act="occNew">+ Повод</button></div>
  <span class="hint">К каждому празднику — дела и покупки «за N дней до». Они сами встают в календарь и в «Покупки».</span>
  ${list.map(card).join('')}
  ${bd.length ? `<section><h2>🎂 Дни рождения в ближайшие 2 месяца</h2><div class="list">${bd.map(({ b, n }) => { const g = state.tasks.filter(t => t.bday === b.id && !t.archived && !t.done); return `<div class="it"><div class="tm">${n.in === 0 ? 'сегодня' : n.in + ' дн.'}</div><div class="grow"><div class="t">${esc(b.name)}${n.age ? ', ' + n.age : ''}</div><div class="m">${esc(fmtDay(n.ds))}${g.length ? ' · ' + g.map(t => '🎁 ' + esc(t.title)).join(', ') : ''}</div></div><button class="btn ghost small" data-act="giftFor" data-id="${b.id}">🎁 Подарок</button></div>`; }).join('')}</div></section>` : ''}
  <details class="card"><summary><b>🎂 Все дни рождения — добавить, изменить</b></summary>${birthdays.render().replace('<h1>Дни рождения</h1>', '')}</details>`;
}

on('giftFor', d => { const b = state.birthdays.find(x => x.id === d.id); if (b) shopSheet(null, { title: 'Подарок: ' + b.name, shop: 'gift', bday: b.id, before: 3 }); });
on('occNew', () => occEdit(null));
on('occOpen', d => { const o = occs().find(x => x.id === d.id); if (o) occSheet(o); });

function occSheet(o) {
  const it = itemsOf(o).map(t => ({ t, ds: planDate(t) })).sort((a, b) => (a.ds || '9').localeCompare(b.ds || '9'));
  const sh = openSheet(`<h3>${o.icon || '🎉'} ${esc(o.name)}</h3><span class="hint">${esc(fmtDay(occDate(o)))} · дела и покупки встают в календарь в свой день</span>
    <div class="subs">${it.map(({ t, ds }) => `<div class="sub-row ${t.done ? 'done' : ''}"><input type="checkbox" class="check" data-o="done" data-id="${t.id}" ${t.done ? 'checked' : ''} aria-label="Сделано"><span class="grow">${t.shop ? shopCat(t.shop).icon + ' ' : ''}${esc(t.title)}</span><span class="hint">за ${+t.before || 0} дн. · ${esc(fmtDay(ds))}</span><button class="x" data-o="del" data-id="${t.id}" aria-label="Удалить">×</button></div>`).join('') || '<span class="hint">Пока пусто.</span>'}</div>
    ${o.id === 'ny' && !it.length ? '<button class="btn" data-o="tpl">🎄 Взять готовый список к Новому году</button>' : ''}
    <h2>Добавить</h2>
    <div class="fields"><label class="field grow">Что сделать или купить<input id="oc-t" placeholder="Купить ёлочные игрушки"></label><label class="field">За дней до<input type="number" id="oc-b" min="0" max="120" value="7"></label></div>
    <label class="field">Это покупка?<select id="oc-s"><option value="">Нет, это дело</option>${SHOP_CATS.map(c => `<option value="${c.id}">${c.icon} Да: ${c.name}</option>`).join('')}</select></label>
    <button class="btn ghost small" data-o="add">+ Добавить</button>
    <div class="actions"><button class="btn ghost" data-o="edit">Изменить повод</button><button class="btn" data-o="close">Готово</button></div>`, o.name);
  sh.addEventListener('click', e => {
    const b = e.target.closest('[data-o]'); if (!b) return;
    const k = b.dataset.o;
    if (k === 'close') return closeSheet();
    if (k === 'edit') { closeSheet(); return occEdit(o); }
    if (k === 'done') { const t = getTask(b.dataset.id); t.done = b.checked; commit(); return; }
    if (k === 'del') { deleteTask(b.dataset.id); closeSheet(); occSheet(o); return; }
    if (k === 'tpl') { for (const x of NY_TEMPLATE) addTask(newTask({ title: x.title, kind: 'once', occ: o.id, before: x.before, date: '', time: '', dur: 30, cat: x.shop ? 'shop' : 'family', ...(x.shop ? { shop: x.shop } : {}) })); closeSheet(); occSheet(o); toast('Список к Новому году готов — поправь под себя'); return; }
    if (k === 'add') {
      const ti = document.getElementById('oc-t').value.trim(); if (!ti) return document.getElementById('oc-t').focus();
      const s = document.getElementById('oc-s').value;
      addTask(newTask({ title: ti, kind: 'once', occ: o.id, before: Math.max(0, +document.getElementById('oc-b').value || 0), date: '', time: '', dur: 30, cat: s ? 'shop' : 'family', ...(s ? { shop: s } : {}) }));
      closeSheet(); occSheet(o); toast('Добавлено');
    }
  });
}

function occEdit(o) {
  const x = o || { name: '', icon: '🎉', md: '', date: '' };
  const sh = openSheet(`<h3>${o ? 'Изменить повод' : 'Новый повод'}</h3>
    <div class="fields"><label class="field">Значок<input id="oe-i" value="${esc(x.icon || '🎉')}" maxlength="4" style="width:70px"></label><label class="field grow">Название<input id="oe-n" value="${esc(x.name)}" placeholder="Годовщина свадьбы"></label></div>
    <div class="fields"><label class="field">Дата<input type="date" id="oe-d" value="${esc(x.date || (x.md ? today().slice(0, 4) + '-' + x.md : ''))}" ${x.rule ? 'disabled' : ''}></label>
    <label class="field">Каждый год<select id="oe-y" ${x.rule ? 'disabled' : ''}><option value="1" ${!x.date ? 'selected' : ''}>Да</option><option value="0" ${x.date ? 'selected' : ''}>Нет, один раз</option></select></label></div>
    ${x.rule ? '<span class="hint">Дата считается сама (последнее воскресенье ноября).</span>' : ''}
    <div class="actions">${o ? '<button class="btn ghost danger" data-e="del">Удалить повод</button>' : '<span></span>'}<span class="row"><button class="btn ghost" data-e="close">Закрыть</button><button class="btn" data-e="save">Сохранить</button></span></div>`, 'Повод');
  sh.addEventListener('click', e => {
    const b = e.target.closest('[data-e]'); if (!b) return;
    if (b.dataset.e === 'close') return closeSheet();
    if (b.dataset.e === 'del') { if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Точно? Дела к нему тоже удалятся'; return; } state.tasks = state.tasks.filter(t => t.occ !== o.id); state.meta.occasions = occs().filter(z => z !== o); commit(); closeSheet(); toast('Повод удалён'); return; }
    if (b.dataset.e === 'save') {
      const name = document.getElementById('oe-n').value.trim(), d = document.getElementById('oe-d').value;
      if (!name) return document.getElementById('oe-n').focus();
      if (!x.rule && !d) return document.getElementById('oe-d').focus();
      const rec = { name, icon: document.getElementById('oe-i').value.trim() || '🎉' };
      if (!x.rule) { if (document.getElementById('oe-y').value === '1') { rec.md = d.slice(5); rec.date = ''; } else { rec.date = d; rec.md = ''; } }
      if (o) Object.assign(o, rec); else occs().push({ id: uid(), ...rec });
      commit(); closeSheet(); toast('Сохранено');
    }
  });
}
