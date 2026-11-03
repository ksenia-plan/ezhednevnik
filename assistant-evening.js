// Вечерний разбор: за час до сна — что за день не сделано и что с этим делать.
// Баннер виден на любой вкладке; в листе — перенести на завтра / другой день / пропустить / сделано, или «перестроить всё».
import { state, commit, undoSnapshot } from './core-store.js?v=2.6.3';
import { esc, on, openSheet, closeSheet, toast, saveUndo } from './ui.js?v=2.6.3';
import { today, addDays, fmtDay, toMin, nowMin } from './core-dates.js?v=2.6.3';
import { flagsOf } from './core-flags.js?v=2.6.3';
import { itemsOn, moveOptions, itemTitle } from './core-occur.js?v=2.6.3';
import { getTask, moveItem, skipItem, setDone } from './tasks-model.js?v=2.6.3';
import { cat } from './core-seed.js?v=2.6.3';

/** Время отбоя сегодня (в минутах). */
function bedTime(ds = today()) {
  const st = state.settings, off = flagsOf(ds).has('my_off');
  return toMin(off ? st.dayEndOff : st.dayEnd) ?? 1260;
}
/** Невыполненные дела сегодняшнего дня (без работы, детских пометок и дней рождения). */
export function undoneToday() {
  const ds = today();
  return itemsOn(ds).filter(i => i.task && !i.sub && !i.done && !i.task.block && !i.task.info && !i.task.booking);
}
/** Показывать ли разбор: с «отбой − 60 мин», если что-то не сделано и сегодня разбор не закрыт. */
export function eveningDue() {
  const ds = today();
  if ((state.meta.eveDone || {})[ds]) return false;
  if (nowMin() < bedTime(ds) - 60) return false;
  return undoneToday().length > 0;
}
export function eveningBanner() {
  if (!eveningDue()) return '';
  const n = undoneToday().length;
  return `<button class="eve-banner" data-act="evening">🌙 Итоги дня: не сделано ${n}. Разобрать — перенести или пропустить ›</button>`;
}

/** Лучший новый день для дела: ближайший подходящий начиная с завтра (по его условиям и свободному времени). */
function bestSlot(i) {
  const t = i.task;
  if (t.kind === 'repeat' && t.rule?.freq === 'daily') return null; // ежедневное — завтра и так будет
  return moveOptions(t, i.orig, 1, addDays(today(), 1))[0] || null;
}

export function openEvening() {
  const list = undoneToday();
  const row = i => {
    const t = i.task, b = bestSlot(i), daily = t.kind === 'repeat' && t.rule?.freq === 'daily';
    return `<div class="eve-row" style="--c:${cat(t.cat).color}" data-id="${t.id}" data-orig="${i.orig}">
      <div class="eve-t"><b>${esc(itemTitle(i))}</b><span class="hint">${i.time || 'без времени'}${daily ? ' · каждый день — завтра будет снова' : ''}</span></div>
      <div class="chips sm">
        <button class="chip" data-e="done">✓ Сделала</button>
        ${b ? `<button class="chip on" data-e="to" data-v="${b.ds}|${b.time}">→ ${esc(fmtDay(b.ds))}, ${b.time}</button>` : ''}
        <button class="chip" data-e="pick">📅 Другой день</button>
        <button class="chip" data-e="skip">Пропустить</button>
      </div></div>`;
  };
  const sh = openSheet(`<h3>🌙 Итоги дня</h3><span class="hint">Что не успела сегодня. «→» — ближайший подходящий день по правилам дела и свободному времени; календарь перестроится сам, ручные записи не сдвигаются.</span>
    <div class="eve-list">${list.map(row).join('') || '<div class="empty">Всё сделано 👍</div>'}</div>
    <div class="actions"><button class="btn ghost" data-e="close">Позже</button><button class="btn" data-e="all">Перестроить всё</button></div>
    <span class="hint">«Перестроить всё»: разовые и «N раз в неделю» — на ближайший подходящий день, ежедневные — пропустить сегодня.</span>`, 'Итоги дня');
  sh.addEventListener('click', e => {
    const b = e.target.closest('[data-e]'); if (!b) return;
    const k = b.dataset.e;
    if (k === 'close') return closeSheet();
    if (k === 'all') {
      const before = undoSnapshot(); let moved = 0, skipped = 0;
      for (const i of undoneToday()) { const s = bestSlot(i); if (s) { moveItem(i.task, i.orig, s.ds, s.time); moved++; } else { skipItem(i.task, i.orig); skipped++; } }
      state.meta.eveDone = { ...(state.meta.eveDone || {}), [today()]: true }; commit();
      closeSheet(); saveUndo(before); toast(`Перестроено: перенесено ${moved}, пропущено ${skipped}`); return;
    }
    const r = b.closest('.eve-row'); if (!r) return;
    const t = getTask(r.dataset.id), orig = r.dataset.orig; if (!t) return;
    if (k === 'done') setDone(t, orig, true);
    if (k === 'skip') skipItem(t, orig);
    if (k === 'to') { const [d, tm] = b.dataset.v.split('|'); moveItem(t, orig, d, tm); toast(`${t.title}: ${fmtDay(d)}, ${tm}`); }
    if (k === 'pick') { closeSheet(); import('./calendar-view.js?v=2.6.3').then(v => v.itemSheet(t.id, orig, today())); return; }
    r.remove();
    if (!sh.querySelector('.eve-row')) { state.meta.eveDone = { ...(state.meta.eveDone || {}), [today()]: true }; commit(); closeSheet(); toast('День разобран 👍'); }
  });
}
on('evening', () => openEvening());
