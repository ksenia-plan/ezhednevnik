// Помощник: локальные правила, без нейросети. Смотрит на расписание и предлагает действия.
// Каждое предложение можно принять (выполняется действие) или отклонить (скрывается на время).
import { state, commit } from './core-store.js?v=2.6.3';
import { BEAUTY_RE } from './core-seed.js?v=2.6.3';
import { esc, on, toast, openSheet, closeSheet } from './ui.js?v=2.6.3';
import { today, addDays, diffDays, fmtDay, fromMin, toMin, nowMin, weekStart, plural } from './core-dates.js?v=2.6.3';
import { itemsOn, freeGaps, overdue, afterDay, freeForManual } from './core-occur.js?v=2.6.3';
import { nextBirthday } from './birthdays-model.js?v=2.6.3';
import { giftTask } from './birthdays-view.js?v=2.6.3';
import { moveItem, setDone, updateTask, getTask } from './tasks-model.js?v=2.6.3';
import { openEditor } from './tasks-editor.js?v=2.6.3';
import { bookingOptions, ruleFor, apptTitle, planFor, gapHint } from './core-booking.js?v=2.6.3';
import { addTask, newTask } from './tasks-model.js?v=2.6.3';

const dismissed = key => { const u = state.meta.dismiss?.[key]; return u && today() <= u; };

/** Собрать все актуальные предложения. */
export function suggestions() {
  const t = today(), out = [];
  const add = s => { if (!dismissed(s.key)) out.push(s); };

  // 1. Дни рождения
  for (const b of state.birthdays) {
    const n = nextBirthday(b), warn = Math.max(...(b.warn && b.warn.length ? b.warn : [7, 1]));
    if (n.in > warn || (b.greeted || {})[n.ds.slice(0, 4)]) continue; // поздравила — подсказку убираем
    const hasGift = state.tasks.some(x => x.title === `Подарок: ${b.name}` && x.date && x.date >= addDays(n.ds, -14) && x.date <= n.ds);
    add({ key: `bd:${b.id}:${n.ds}`, c: 'var(--danger)', t: n.in === 0 ? `Сегодня день рождения: ${b.name}` : `Через ${n.in} ${plural(n.in, 'день', 'дня', 'дней')} день рождения: ${b.name}${n.age ? ', ' + n.age : ''}`, sub: hasGift ? 'Задача на подарок уже есть' : 'Добавить задачу на подарок?', yes: hasGift ? null : 'Добавить задачу', act: 'gift', id: b.id });
  }
  // 2. Просроченные
  const od = overdue();
  if (od.length) add({ key: `od:${t}`, c: 'var(--danger)', t: `${od.length} ${plural(od.length, 'дело просрочено', 'дела просрочены', 'дел просрочено')}`, sub: od.slice(0, 3).map(x => x.title).join(', '), yes: 'Все на сегодня', act: 'odAll' });
  // 3. Пора записаться (процедуры, врачи)
  for (const x of state.tasks.filter(x => x.booking && x.kind === 'repeat' && !x.archived)) {
    const d = afterDay(x); if (!d || diffDays(t, d) > 28) continue; // записываюсь заранее — напоминаю за 4 недели
    add({ key: `bk:${x.id}:${d}`, c: '#B0518F', t: x.title, sub: (d <= t ? 'Срок подошёл' : `Срок — ${fmtDay(d)}`) + (ruleFor(x).why ? ' · окна ' + ruleFor(x).why : ''), slots: bookingOptions(x, 4), yes: 'Своё время', act: 'booked', id: x.id });
  }
  // 4. Напомнить заранее (показания счётчиков и т.п.)
  for (const x of state.tasks.filter(x => +x.remind > 0 && !x.archived)) {
    for (let i = 1; i <= +x.remind; i++) {
      const ds = addDays(t, i);
      if (itemsOn(ds).some(it => it.task === x)) add({ key: `rm:${x.id}:${ds}`, c: 'var(--warn)', t: `Через ${i} ${plural(i, 'день', 'дня', 'дней')}: ${x.title}`, sub: x.note || fmtDay(ds), act: 'ok' });
    }
  }
  // 5. Английский в свободное окно сегодня
  const en = itemsOn(t).find(i => i.task && i.task.tab === 'english');
  if (en && !en.done && (!en.time || toMin(en.time) + en.dur < nowMin())) {
    const g = freeGaps(t, 20)[0];
    if (g) add({ key: `en:${t}`, c: 'var(--a-en,#B98110)', t: `Окно в ${fromMin(g[0])} — вставить английский?`, sub: 'Сегодня задание ещё не сделано', yes: `Поставить на ${fromMin(g[0])}`, act: 'enSlot', id: en.task.id, orig: en.orig, v: fromMin(g[0]) });
  }
  // 6. Важные дела без даты — в ближайшее окно
  const und = state.tasks.filter(x => !x.archived && x.kind === 'once' && !x.date && !x.done && x.important).slice(0, 2);
  for (const x of und) {
    let slot = null;
    for (let i = 0; i < 4 && !slot; i++) { const ds = addDays(t, i); const g = freeGaps(ds, +x.dur || 30)[0]; if (g) slot = { ds, s: fromMin(g[0]) }; }
    if (slot) add({ key: `un:${x.id}:${slot.ds}`, c: 'var(--accent)', t: `${fmtDay(slot.ds)[0].toUpperCase() + fmtDay(slot.ds).slice(1)} окно в ${slot.s} — поставить «${x.title}»?`, sub: 'Важное дело пока без даты', yes: 'Поставить', act: 'place', id: x.id, v: `${slot.ds}|${slot.s}` });
  }
  // 7. Фитнес на следующей неделе
  const nm = addDays(weekStart(t), 7);
  const fit = state.tasks.find(x => (x.title === 'Спорт' || x.title === 'Фитнес') && x.kind === 'repeat' && !x.archived);
  if (fit) { const n = [...Array(7)].filter((_, i) => itemsOn(addDays(nm, i)).some(it => it.task === fit)).length; if (n < 2) add({ key: `fit:${nm}`, c: 'var(--ok)', t: `На следующей неделе фитнес встаёт ${n} ${plural(n, 'раз', 'раза', 'раз')}`, sub: 'По правилам (смены мужа, цикл, дача) подходящих дней мало. Можно перенести вручную.', act: 'ok' }); }
  // 8. Резервная копия
  const last = state.meta.lastBackup, every = +state.settings.backupEveryDays || 7;
  if ((!last && diffDays(state.meta.startedAt || t, t) >= 2) || (last && diffDays(last.slice(0, 10), t) >= every))
    add({ key: `bk-copy:${t}`, c: 'var(--muted)', t: 'Сохрани копию данных', sub: last ? `Последняя копия — ${fmtDay(last.slice(0, 10))}` : 'Данные хранятся только в телефоне — копия защитит от потери', yes: 'Сохранить копию', act: 'backup' });
  return out;
}

export function suggestionsHtml(limit = 99) {
  const s = suggestions(); if (!s.length) return '';
  const shown = s.slice(0, limit);
  return `<section><div class="row between"><h2>Помощник предлагает</h2>${s.length > limit ? `<button class="btn ghost small" data-act="openTab" data-v="assistant">Все (${s.length})</button>` : ''}</div><div class="list">${shown.map(x => `<div class="sug" style="--c:${x.c}"><span class="mk"></span><div class="txt"><span class="t">${esc(x.t)}</span>${x.sub ? `<span class="hint">${esc(x.sub)}</span>` : ''}${x.slots ? (x.slots.length ? `<div class="chips">${x.slots.map(s => slotChip(s, x.key, true)).join('')}</div><span class="hint">Нажми окно — проверишь и подтвердишь запись. 🤝 — в этот день можно сделать обе процедуры.</span>` : '<span class="hint">Свободных окон по правилам в ближайший месяц нет.</span>') : ''}<span class="row">${x.yes ? `<button class="btn small" data-act="sugYes" data-a="${x.act}" data-id="${esc(x.id || '')}" data-orig="${esc(x.orig || '')}" data-v="${esc(x.v || '')}" data-key="${esc(x.key)}">${esc(x.yes)}</button>` : ''}<button class="btn ghost small" data-act="sugNo" data-key="${esc(x.key)}">${x.yes ? 'Отклонить' : 'Понятно'}</button></span></div></div>`).join('')}</div></section>`;
}

export function render() {
  return `<h1>Помощник</h1><span class="hint">Подсказки считаются в телефоне по твоему расписанию: окна, сроки, дни рождения, записи.</span>${suggestionsHtml() || '<div class="empty">Сейчас предложений нет.</div>'}`;
}

function dismiss(key, days = 1) { state.meta.dismiss = { ...(state.meta.dismiss || {}), [key]: addDays(today(), days - 1) }; }
on('sugNo', d => { dismiss(d.key, d.key.startsWith('bk:') ? 3 : 1); commit(); });
on('sugYes', d => {
  const a = d.a;
  if (a === 'gift') { const b = state.birthdays.find(x => x.id === d.id); if (b) { giftTask(b); toast('Задача на подарок добавлена'); } }
  if (a === 'odAll') { for (const x of overdue()) moveItem(x, x.date, today()); toast('Перенесено на сегодня'); }
  if (a === 'booked') { const x = getTask(d.id); setDone(x, afterDay(x), true); openEditor(null, { title: x.title.replace(/^Записаться:\s*/, ''), cat: 'care', date: today(), dur: 60 }); toast('Укажи дату и время записи'); }
  if (a === 'enSlot') { const x = getTask(d.id); moveItem(x, d.orig, today(), d.v); toast('Английский — в ' + d.v); }
  if (a === 'place') { const [ds, tm] = d.v.split('|'); updateTask(d.id, { date: ds, time: tm }); toast(`Поставила: ${fmtDay(ds)}, ${tm}`); }
  if (a === 'backup') { window.app.go('settings'); setTimeout(() => document.getElementById('backup')?.scrollIntoView(), 50); return; }
  dismiss(d.key, 30); commit();
});

/** Записаться в предложенное окно: создаём запись (её приложение не двигает) и отмечаем напоминание выполненным. */
export function bookAt(id, v, key) {
  const x = getTask(id); if (!x) return;
  const [ds, tm, dur, title, withId] = v.split('|');
  addTask(newTask({ title: title || apptTitle(x), cat: x.cat || 'care', date: ds, time: tm, dur: +dur || 60 }));
  // следующий срок считается от новой записи (для «маникюр + педикюр» — у обеих процедур)
  for (const y of [x, withId && getTask(withId)].filter(Boolean)) y.doneOn = {};
  if (key) dismiss(key, 30);
  commit(); toast(`Записала: ${apptTitle(x)}, ${fmtDay(ds)} ${tm}`);
}
on('bookSlot', d => { const [ds, time, dur, title, withId] = d.v.split('|'); const x = getTask(d.id); if (!x) return; confirmBook([{ ds, time, dur: +dur || 60, title: title || apptTitle(x), ids: [d.id, withId].filter(Boolean) }], d.key); });

/** Окно предложено — перед записью можно поправить название, дату, время и длительность, затем подтвердить. */
export function confirmBook(list, key) {
  const row = (w, i) => `<div class="card" data-i="${i}">
    ${list.length > 1 ? `<label class="row"><input type="checkbox" data-f="on" checked> <b>Записать</b></label>` : ''}
    ${w.combo ? `<label class="row"><input type="checkbox" data-f="combo"> 🤝 Вместе с ${/маникюр/i.test(w.title) ? 'педикюром' : 'маникюром'}: ${esc(fmtDay(w.combo.ds))}, ${w.combo.time}, ${w.combo.dur / 60} ч</label>` : ''}
    <div class="fields"><label class="field">Что<input data-f="title" value="${esc(w.title)}"></label>
    <label class="field">Дата<input type="date" data-f="ds" value="${w.ds}"></label>
    <label class="field">Время<input type="time" data-f="time" value="${w.time}"></label>
    <label class="field">Длительность, мин<input type="number" min="15" step="15" data-f="dur" value="${w.dur}"></label></div>
    <span class="hint" data-f="gap">${esc(gapHint(w.prev, w.norm, w.ds, w.tol))}</span>
    <span class="hint warn" data-f="warn" hidden></span></div>`;
  const sh = openSheet(`<h3>${list.length > 1 ? 'Проверь записи' : 'Проверь запись'}</h3><span class="hint">Можно поправить дату, время и длительность — как договоришься с мастером или врачом. После записи приложение её не двигает.</span>
    ${list.map(row).join('')}
    <div class="actions"><button class="btn ghost" data-z="cancel">Отмена</button><button class="btn" data-z="ok">Записать</button></div>`, 'Запись');
  sh.addEventListener('change', e => {
    if (e.target.dataset.f !== 'combo') return;
    const el = e.target.closest('[data-i]'), w = list[+el.dataset.i], src = e.target.checked ? w.combo : w;
    for (const f of ['title', 'ds', 'time', 'dur']) el.querySelector(`[data-f="${f}"]`).value = src[f];
    el.querySelector('[data-f="gap"]').textContent = gapHint(w.prev, w.norm, src.ds, w.tol);
  });
  sh.addEventListener('input', e => {
    const el = e.target.closest('[data-i]');
    if (el && e.target.dataset.f === 'ds') { const w = list[+el.dataset.i]; el.querySelector('[data-f="gap"]').textContent = gapHint(w.prev, w.norm, e.target.value, w.tol); } sh.querySelector('[data-z="ok"]').textContent = 'Записать'; delete sh.querySelector('[data-z="ok"]').dataset.sure; });
  sh.addEventListener('click', e => {
    const b = e.target.closest('[data-z]'); if (!b) return;
    if (b.dataset.z === 'cancel') return closeSheet();
    const rows = [...sh.querySelectorAll('[data-i]')].map(el => {
      const g = f => el.querySelector(`[data-f="${f}"]`);
      const base = list[+el.dataset.i], cb = g('combo') && g('combo').checked;
      return { el, on: !g('on') || g('on').checked, w: { ...base, ids: cb ? base.combo.ids : base.ids, title: g('title').value.trim() || list[+el.dataset.i].title, ds: g('ds').value, time: g('time').value, dur: Math.max(15, +g('dur').value || 60) } };
    }).filter(r => r.on);
    if (!rows.length) return closeSheet();
    let warned = false;
    for (const r of rows) {
      const wEl = r.el.querySelector('[data-f="warn"]'), st = toMin(r.w.time);
      const msg = !r.w.ds || st === null ? 'Укажи дату и время' : (freeForManual(r.w.ds, r.w.dur, /кров/i.test(r.w.title)).some(([a, z]) => st >= a && st + r.w.dur <= z) ? '' : 'В это время уже что-то стоит или это вне твоего дня');
      wEl.hidden = !msg; wEl.textContent = msg ? '⚠ ' + msg : '';
      if (msg) warned = true;
    }
    if (rows.some(r => !r.w.ds || toMin(r.w.time) === null)) return;
    if (warned && !b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Всё равно записать'; return; }
    closeSheet(); bookPlan(rows.map(r => r.w)); if (key) dismiss(key, 30);
  });
}

/** Записать весь план: создаём записи (они закрепляются) и обновляем дату последней записи у процедур. */
export function bookPlan(plan) {
  for (const w of plan) {
    addTask(newTask({ title: w.title, cat: BEAUTY_RE.test(w.title) ? 'beauty' : 'care', date: w.ds, time: w.time, dur: w.dur }));
    for (const id of w.ids || []) { const y = getTask(id); if (y) y.doneOn = {}; }
  }
  commit(); toast(`Записала: ${plan.length} ${plan.length === 1 ? 'запись' : 'записей'}`);
}
on('bookPlanOne', d => { const w = JSON.parse(decodeURIComponent(d.v)); confirmBook([w], d.key); });
on('bookPlanAll', d => { const t = getTask(d.id); if (!t) return; confirmBook(planFor(t)); });
function closeIfOpen() { const sc = document.getElementById('scrim'); if (!sc.hidden) { sc.hidden = true; sc.innerHTML = ''; } }

/** Кнопка-окно для записи. 🤝 — в этот день можно объединить маникюр и педикюр. */
export function slotChip(w, key = '', noTitle = false) {
  return `<button class="chip${w.combo ? ' combo' : ''}" data-act="bookPlanOne" data-key="${esc(key)}" data-v="${encodeURIComponent(JSON.stringify(w))}">${noTitle ? '' : esc(w.title) + ': '}${esc(fmtDay(w.ds))} ${w.time}${w.norm ? deltaBadge(w.norm, w.ds, w.tol) : ''}${w.combo ? (w.combo.ds === w.ds ? ' 🤝' : ` · 🤝 вместе ${esc(fmtDay(w.combo.ds))}`) : ''}</button>`;
}

const deltaBadge = (norm, ds, tol = 0) => { const d = diffDays(norm, ds); return d === 0 || Math.abs(d) <= tol ? '' : ` (${d > 0 ? '+' : '−'}${Math.abs(d)} дн.)`; };
