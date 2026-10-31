// Точка входа: загрузка данных, маршрутизация по вкладкам, общие обработчики, быстрое добавление.
import { state, load, onChange, restoreSnapshot } from './core-store.js';
import { initFlags, resetFlagCache } from './core-flags.js';
import { resetOccurCache } from './core-occur.js';
import { esc, on, dispatch, openSheet, closeSheet, toast, sheetOpen, setUndoApply } from './ui.js';
import { today, fmtDay, addDays } from './core-dates.js';
import { itemsOn, lastAppt } from './core-occur.js';
import { planFor } from './core-booking.js';
import { CATS, cat } from './core-seed.js';
import { describeRule } from './core-recur.js';
import * as calendar from './calendar-view.js';
import * as work from './work-view.js';
import * as birthdays from './birthdays-view.js';
import * as flags from './flags-view.js';
import * as assistant from './assistant-suggest.js';
import * as claude from './claude-view.js';
import * as settings from './settings-view.js';
import { TAB_MODULES, tabModule } from './tabs-registry.js';
import { parseText, addTask, newTask } from './tasks-model.js';
import { openEditor } from './tasks-editor.js';
import { eveningBanner } from './assistant-evening.js';

const ICONS = {
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/>',
  birthdays: '<path d="M4 21h16M5 21v-7h14v7M12 14V9M12 9c-1.5 0-2-1-2-2s2-3 2-3 2 2 2 3-.5 2-2 2z"/>',
  more: '<circle cx="5.5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18.5" cy="12" r="1.5"/>'
};
// нижняя панель: 4 основных раздела + первая вкладка-модуль
const BOTTOM = [['calendar', 'Календарь'], ['work', 'Планы'], ['birthdays', 'ДР'], [TAB_MODULES[0].id, TAB_MODULES[0].name], ['more', 'Ещё']];

let route = 'calendar';
const SCREENS = {
  calendar: calendar.render, work: work.render, birthdays: birthdays.render, flags: flags.render,
  assistant: assistant.render, claude: claude.render, settings: settings.render, more: moreView, all: allTasksView
};

function moreView() {
  const items = [['all', '📋', 'Все задачи и серии', 'поиск, фильтры, все даты каждого дела'], ['assistant', '💡', 'Помощник', 'окна для записей, что перенести, подсказки'], ['flags', '🗓', 'Признаки дня и периоды', 'отпуск, каникулы, дача, больничный, цикл'],
    ...TAB_MODULES.slice(1).map(m => [m.id, '🧘', m.name, 'комплексы и видео']), ['claude', '✨', 'Для Claude', 'обмен с чатом: мемо, задачи, правки'], ['settings', '⚙️', 'Настройки', 'тема, режим дня, график мужа, резервная копия']];
  return `<h1>Ещё</h1><div class="list">${items.map(([id, ic, n, h]) => `<div class="it more-it" data-act="openTab" data-v="${id}" style="cursor:pointer"><div class="tm" style="font-size:22px;text-align:center">${ic}</div><div class="grow"><div class="t">${n}</div><div class="m">${h}</div></div><span class="hint" style="font-size:20px">›</span></div>`).join('')}</div>`;
}
let allFilter = '', allKind = 'all';
const ALL_KINDS = [['all', 'Все'], ['fav', '★ Избранное'], ['repeat', 'Регулярные'], ['beauty', '💅 Красота'], ['book', 'Врачи'], ['once', 'Разовые'], ['kids', 'Дети']];
function allTasksView() {
  const q = allFilter.toLowerCase().trim();
  const t0 = today(), next = new Map();
  for (let i = 0; i < 62; i++) { const ds = addDays(t0, i); for (const it of itemsOn(ds)) if (it.task && !it.done) { const a = next.get(it.task) || []; a.push(it); next.set(it.task, a); } }
  const sd = ds => { const d = new Date(ds + 'T12:00'); return ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][d.getDay()] + ' ' + d.getDate() + '.' + String(d.getMonth() + 1).padStart(2, '0'); };
  const kindOf = t => t.cat === 'beauty' ? 'beauty' : t.info ? 'kids' : t.booking ? 'book' : t.kind === 'repeat' ? 'repeat' : 'once';
  const all = state.tasks.filter(t => !t.archived && !t.sys && (t.kind !== 'once' || !t.done));
  const list = all.filter(t => (!q || t.title.toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q)) && (allKind === 'all' || (allKind === 'fav' ? t.fav : kindOf(t) === allKind)));
  // ближайшая дата — для сортировки и крупной подписи
  const nextOf = t => {
    if (t.booking && /маникюр|педикюр|брови|стрижк/i.test(t.title)) { const p = planFor(t)[0]; return p ? { ds: p.ds, time: p.time, pre: 'план' } : null; }
    if (t.kind === 'once') return t.date ? { ds: t.date, time: t.time } : null;
    const it = (next.get(t) || [])[0]; return it ? { ds: it.ds, time: it.time } : null;
  };
  const chips = t => {
    if (t.booking && /маникюр|педикюр|брови|стрижк/i.test(t.title)) { const la = lastAppt(t); return (la ? `<span class="chip on">запись ${sd(la)}</span>` : '') + planFor(t).slice(0, 3).map(w => `<span class="chip">план ${sd(w.ds)}</span>`).join(''); }
    if (t.kind === 'once') return '';
    const its = next.get(t) || [];
    return its.slice(1, 5).map(i => `<span class="chip">${sd(i.ds)}${i.time ? ' ' + i.time : ''}</span>`).join('') + (its.length > 5 ? `<span class="chip">+${its.length - 5}</span>` : '');
  };
  const act = t => t.kind === 'repeat' ? `data-act="series" data-id="${t.id}"` : t.date ? `data-act="item" data-id="${t.id}" data-orig="${t.date}" data-ds="${t.date}"` : `data-act="editTask" data-id="${t.id}"`;
  const row = t => { const n = nextOf(t), c = cat(t.cat).color;
    return `<div class="tcard" ${act(t)} style="--c:${c}">
      <button class="star ${t.fav ? 'on' : ''}" data-act="fav" data-id="${t.id}" aria-label="${t.fav ? 'Убрать из избранного' : 'В избранное'}">${t.fav ? '★' : '☆'}</button>
      <div class="tc-main"><div class="tc-title">${esc(t.title)}</div>
        <div class="tc-sub">${t.kind === 'repeat' ? esc(describeRule(t)) : t.date ? 'разовое' : 'без даты'}${t.cond ? ' · с условием' : ''}${t.dur && !t.booking && !t.info ? ' · ' + (t.dur >= 60 ? (t.dur / 60).toString().replace('.', ',') + ' ч' : t.dur + ' мин') : ''}</div>
        ${chips(t) ? `<div class="chips sm">${chips(t)}</div>` : ''}</div>
      <div class="tc-next">${n ? `<b>${n.pre ? n.pre + ' ' : ''}${sd(n.ds)}</b><span>${n.time || ''}</span>` : '<span class="hint">—</span>'}</div>
      <button class="tc-edit" data-act="editTask" data-id="${t.id}" aria-label="Изменить">✎</button></div>`; };
  const byNext = (a, b) => ((nextOf(a) || {}).ds || '9').localeCompare((nextOf(b) || {}).ds || '9') || a.title.localeCompare(b.title, 'ru');
  const groups = [
    ['★ Избранное', list.filter(t => t.fav)],
    ['Регулярные', list.filter(t => !t.fav && kindOf(t) === 'repeat')],
    ['💅 Красота', list.filter(t => !t.fav && kindOf(t) === 'beauty')],
    ['Врачи и анализы', list.filter(t => !t.fav && kindOf(t) === 'book')],
    ['Разовые', list.filter(t => !t.fav && kindOf(t) === 'once')],
    ['Дети', list.filter(t => !t.fav && kindOf(t) === 'kids')]
  ].filter(g => g[1].length);
  const cnt = k => k === 'all' ? all.length : k === 'fav' ? all.filter(t => t.fav).length : all.filter(t => kindOf(t) === k).length;
  return `<div class="row between"><h1>Все задачи и серии</h1><button class="btn small" data-act="newTask">+ Дело</button></div>
  <input id="all-q" class="inp" type="search" placeholder="Поиск по названию и заметкам" value="${esc(allFilter)}">
  <div class="chips sm">${ALL_KINDS.map(([k, n]) => `<button class="chip" data-act="allKind" data-v="${k}" aria-pressed="${allKind === k}">${n} <small>${cnt(k)}</small></button>`).join('')}</div>
  <span class="hint">Нажми на дело — все его даты, перенос и пропуск. ✎ — изменить правило или удалить. ☆ — закрепить наверху.</span>
  ${groups.map(([h, ts]) => `<section><h2>${h} <small>${ts.length}</small></h2><div class="tlist">${ts.sort(byNext).map(row).join('')}</div></section>`).join('') || '<div class="empty">Ничего не найдено.</div>'}`;
}
on('allKind', d => { allKind = d.v; render(); });
on('newTask', () => openEditor(null));

export function render() {
  const main = document.getElementById('main');
  const ae = document.activeElement;
  // не перерисовываем, пока человек печатает в поле (кроме поиска)
  if (ae && main.contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName) && ae.type !== 'checkbox' && ae.id !== 'all-q' && ae.id !== 'ser-q') { render.pending = true; return; }
  const keep = {}; for (const id of ['w-in', 'cl-in']) { const el = document.getElementById(id); if (el) keep[id] = el.value; }
  const y = window.scrollY;
  const mod = tabModule(route);
  main.classList.toggle('wide', route === 'calendar' && calendar.cal.view === 'week');
  main.innerHTML = eveningBanner() + (mod ? mod.render() : (SCREENS[route] || SCREENS.calendar)());
  for (const id in keep) { const el = document.getElementById(id); if (el) el.value = keep[id]; }
  for (const qid of ['all-q', 'ser-q']) { const s = document.getElementById(qid); if (s && ae?.id === qid) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
  window.scrollTo(0, y);
  document.querySelectorAll('.tabs button').forEach(b => b.toggleAttribute('aria-current', b.dataset.v === route || (b.dataset.v === 'more' && !BOTTOM.some(x => x[0] === route))));
  document.getElementById('fab').hidden = !['calendar', 'work', 'all'].includes(route);
  window.__plannerRendered = true;
}
export function go(r) { route = r; render(); window.scrollTo(0, 0); }

/* ---------- быстрое добавление: текст или голос → задачи ---------- */
/** Мои дела для выбора: уникальные названия, сначала избранные и серии. */
function mine() {
  const seen = new Set();
  return state.tasks.filter(t => !t.archived && !t.sys && !t.block && !(t.kind === 'once' && t.done))
    .sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || (a.kind === 'repeat' ? 0 : 1) - (b.kind === 'repeat' ? 0 : 1) || a.title.localeCompare(b.title, 'ru'))
    .filter(t => { const k = t.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}
/** Выбрано своё дело: изменить серию, поставить разово на день или открыть все даты. */
function pickSheet(t, day) {
  const rep = t.kind === 'repeat';
  const sh = openSheet(`<h3>${esc(t.title)}</h3><span class="hint">${rep ? esc(describeRule(t)) : t.date ? 'разовое · ' + esc(fmtDay(t.date)) : 'разовое без даты'}</span>
    <div class="fields"><label class="field">Дата<input type="date" id="pk-d" value="${day}"></label><label class="field">Время<input type="time" id="pk-t" value="${t.time || ''}"></label><label class="field">Длительность, мин<input type="number" id="pk-dur" min="5" step="5" value="${t.dur || 30}"></label></div>
    <div class="actions" style="flex-wrap:wrap;gap:8px"><button class="btn" data-p="once">Поставить разово на эту дату</button>
    ${rep ? '<button class="btn ghost" data-p="edit">Изменить серию: время, интервал, условия</button><button class="btn ghost" data-p="all">📅 Все даты</button>' : '<button class="btn ghost" data-p="edit">Изменить это дело</button>'}</div>`, 'Своё дело');
  sh.addEventListener('click', e => {
    const p = e.target.closest('[data-p]')?.dataset.p; if (!p) return;
    if (p === 'edit') { closeSheet(); openEditor(t.id); }
    if (p === 'all') { closeSheet(); calendar.seriesSheet(t.id); }
    if (p === 'once') {
      const d = document.getElementById('pk-d').value || day, tm = document.getElementById('pk-t').value, dur = +document.getElementById('pk-dur').value || t.dur || 30;
      const x = { title: t.title, cat: t.cat, date: d, time: tm || '', dur, note: t.note || '' };
      closeSheet(); addTask(newTask(x)); toast(`Добавлено: ${t.title}, ${fmtDay(d)}${tm ? ' ' + tm : ''}`);
    }
  });
}
function quickAdd() {
  const day = route === 'calendar' ? calendar.cal.day : today();
  const sh = openSheet(`<h3>Новое дело</h3><span class="hint">Напиши как есть: «завтра в 10 созвон 1 ч», «каждый вторник бассейн в 19:00», «важно отчёт к пятнице». Несколько — через точку с запятой.</span>
  <textarea id="qa" class="inp" rows="3" placeholder="Что сделать"></textarea>
  ${work.speechSupported() ? '<span class="hint">🎤 — распознаёт браузер на серверах Google или Яндекса, нужен интернет.</span>' : ''}
  <div class="actions"><button class="btn ghost" data-x="full">Подробно</button><span class="row">${work.speechSupported() ? '<button class="btn ghost" data-x="mic" id="qa-mic">🎤</button>' : ''}<button class="btn" data-x="add">Добавить</button></span></div>
  <h2>Или выбери из своих дел</h2><input id="qa-f" class="inp" type="search" placeholder="Найти: фитнес, маникюр, уборка…">
  <div class="chips sm" id="qa-list">${mine().map(t => `<button class="chip" data-x="pick" data-id="${t.id}" data-n="${esc(t.title.toLowerCase())}"><span class="dot" style="--c:${cat(t.cat).color}"></span>${esc(t.title)}${t.kind === 'repeat' ? ' ↻' : ''}</button>`).join('')}</div>
  <span class="hint">↻ — серия: можно поменять время, интервал и условия, календарь перестроится. Или поставить её разово на нужный день.</span>`, 'Новое дело');
  sh.addEventListener('input', e => { if (e.target.id !== 'qa-f') return; const q = e.target.value.toLowerCase().trim(); sh.querySelectorAll('#qa-list .chip').forEach(c => { c.hidden = q && !c.dataset.n.includes(q); }); });
  setTimeout(() => document.getElementById('qa')?.focus(), 50);
  let rec = null;
  sh.addEventListener('click', e => {
    const x = e.target.closest('[data-x]')?.dataset.x; const el = document.getElementById('qa');
    if (x === 'full') { closeSheet(); openEditor(null, { date: day, cat: route === 'work' ? 'work' : 'personal', title: el.value.trim() }); }
    if (x === 'pick') { const t = state.tasks.find(y => y.id === e.target.closest('[data-x]').dataset.id); if (t) pickSheet(t, day); return; }
    if (x === 'add') {
      const txt = el.value.trim(); if (!txt) { el.focus(); return; }
      const items = parseText(txt, { date: day === today() ? undefined : day, ...(route === 'work' ? { cat: 'work' } : {}) });
      items.forEach(addTask); closeSheet();
      toast(items.length === 1 ? `Добавлено: ${items[0].title}${items[0].date ? ', ' + fmtDay(items[0].date) : ''}${items[0].time ? ' ' + items[0].time : ''}` : `Добавлено дел: ${items.length}`);
    }
    if (x === 'mic') {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (rec) { rec.stop(); return; }
      try { rec = new SR(); rec.lang = 'ru-RU'; rec.interimResults = true; const base = el.value ? el.value.trim() + ' ' : '';
        rec.onresult = ev => { let s = ''; for (const r of ev.results) s += r[0].transcript; el.value = base + s; };
        rec.onerror = ev => toast(ev.error === 'network' ? 'Нет интернета для распознавания' : 'Не получилось распознать');
        rec.onend = () => { rec = null; const b = document.getElementById('qa-mic'); if (b) b.textContent = '🎤'; };
        rec.start(); e.target.closest('[data-x]').textContent = '■'; } catch (err) { rec = null; toast('Голосовой ввод недоступен'); }
    }
  });
}

/* ---------- общие действия ---------- */
on('openTab', d => go(d.v));
on('editTask', d => openEditor(d.id));
on('nav', d => go(d.v));

async function start() {
  window.__p = 2;
  await load();
  initFlags(state);
  settings.applyTheme();
  onChange(() => { resetFlagCache(); resetOccurCache(); render(); });
  document.getElementById('tabs').innerHTML = `<div>${BOTTOM.map(([id, n]) => `<button data-act="nav" data-v="${id}"><svg viewBox="0 0 24 24">${ICONS[id] || tabModule(id)?.icon || ''}</svg>${esc(n)}</button>`).join('')}</div>`;
  document.addEventListener('click', e => { dispatch(e); });
  document.addEventListener('change', e => { if (flags.onFlagsChange(e)) return; if (settings.onSettingsChange(e)) return; });
  document.addEventListener('input', e => { if (e.target.id === 'all-q') { allFilter = e.target.value; render(); } if (e.target.id === 'ser-q') { calendar.cal.q = e.target.value; render(); } });
  document.addEventListener('focusout', () => setTimeout(() => { if (render.pending) { render.pending = false; render(); } }, 0));
  document.getElementById('scrim').addEventListener('click', e => { if (e.target.id === 'scrim') { closeSheet(); if (render.pending) { render.pending = false; render(); } } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetOpen()) closeSheet(); if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute?.('role') === 'button') { e.preventDefault(); e.target.click(); } });
  document.getElementById('fab-add').addEventListener('click', quickAdd);
  setUndoApply(restoreSnapshot);
  calendar.bindWeekDrag(document.getElementById('main'));
  work.bindWorkDrag(document.getElementById('main'));
  // смена дня: если приложение открыто через полночь — перерисовать
  let lastDay = today();
  setInterval(() => { if (today() !== lastDay) { lastDay = today(); resetFlagCache(); resetOccurCache(); if (calendar.cal.view === 'day') calendar.cal.day = today(); } if (!sheetOpen() && route === 'calendar') render(); }, 60000);
  window.__plannerOk = true;
  render();
}
window.app = { render, go };
start().catch(e => { window.__plannerErr = String(e && e.message || e); console.error(e); });
