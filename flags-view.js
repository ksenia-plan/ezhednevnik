// Признаки дня и периоды: справочник (редактируемый), отметки дней и периодов, календарь цикла.
import { state, commit, uid } from './core-store.js';
import { esc, on, toast, openSheet, closeSheet } from './ui.js';
import { today, dayLabel, fmtDay, addDays, diffDays, plural } from './core-dates.js';
import { flagType, cycleLen, cycleInfo, flagsOf, isDachaDay, resetFlagCache } from './core-flags.js';

/** Отметить или снять ручной признак на один день (кнопки на экране дня). */
export function markDay(flag, ds) {
  if (flag === 'dacha') {
    const off = { ...(state.meta.dachaOff || {}) }, on = flagsOf(ds).has('dacha');
    if (on) { state.flagMarks = state.flagMarks.filter(m => !(m.flag === 'dacha' && m.from === ds && (m.to || m.from) === ds)); if (isDachaDay(ds)) off[ds] = true; toast('Дача снята — расписание пересчитано'); }
    else { delete off[ds]; state.meta.dachaOff = off; resetFlagCache(); if (!isDachaDay(ds)) state.flagMarks.push({ id: uid(), flag: 'dacha', from: ds, to: ds }); toast('Отмечена дача'); }
    state.meta.dachaOff = off; commit(); return;
  }
  const m = state.flagMarks.find(x => x.flag === flag && ds >= x.from && ds <= (x.to || x.from));
  const name = flagType(flag)?.name || flag;
  if (m) {
    // снимаем день: период разрезаем на две части
    state.flagMarks = state.flagMarks.filter(x => x !== m);
    if (m.from < ds) state.flagMarks.push({ ...m, id: uid(), to: addDays(ds, -1) });
    if ((m.to || m.from) > ds) state.flagMarks.push({ ...m, id: uid(), from: addDays(ds, 1) });
    toast(`«${name}» снято — расписание пересчитано`);
  } else { state.flagMarks.push({ id: uid(), flag, from: ds, to: ds }); toast(`Отмечено: ${name}`); }
  commit();
}

export function render() {
  const t = today();
  const marks = state.flagMarks.filter(m => (m.to || m.from) >= addDays(t, -30)).sort((a, b) => a.from.localeCompare(b.from));
  const manual = state.flagTypes.filter(f => !f.auto), auto = state.flagTypes.filter(f => f.auto);
  const ci = cycleInfo(t), starts = [...state.cycleStarts].sort().reverse();
  return `<div class="row between"><h1>Признаки дня</h1></div>
  <section><h2>Отметить период</h2><div class="card">
    <div class="fields"><label class="field">Признак<select id="fm-flag">${manual.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></label>
    <label class="field">С<input type="date" id="fm-from" value="${t}"></label><label class="field">По<input type="date" id="fm-to" value="${t}"></label></div>
    <label class="field wide">Заметка<input id="fm-note" class="inp" placeholder="например: Сочи, санаторий"></label>
    <div><button class="btn" data-act="fmAdd">Отметить</button></div></div></section>
  <section><h2>Отмеченные дни и периоды</h2>${marks.length ? `<div class="list">${marks.map(m => { const f = flagType(m.flag); return `<div class="it"><span class="dot" style="--c:${f?.color || 'var(--muted)'}"></span><div class="grow"><div class="t">${esc(f?.name || m.flag)}</div><div class="m">${esc(dayLabel(m.from))}${m.to && m.to !== m.from ? ' — ' + esc(dayLabel(m.to)) : ''}${m.note ? ' · ' + esc(m.note) : ''}</div></div><button class="x" data-act="fmDel" data-id="${m.id}" aria-label="Удалить отметку">×</button></div>`; }).join('')}</div>` : '<div class="empty">Пока ничего не отмечено. Отпуск, каникулы, дачу и поездки отмечай здесь или кнопками на экране дня.</div>'}</section>
  <section><h2>Мои признаки</h2><div class="list">${manual.map(f => `<div class="it"><input type="color" value="${f.color}" data-act="noop" data-fcolor="${f.id}" aria-label="Цвет" style="width:36px;height:36px;border:0;background:none;padding:0"><div class="grow"><input class="inp" value="${esc(f.name)}" data-fname="${f.id}" aria-label="Название признака"></div><button class="x" data-act="ftDel" data-id="${f.id}" aria-label="Удалить признак">×</button></div>`).join('')}</div>
    <div class="row"><input id="ft-new" class="inp grow" placeholder="Новый признак, например «Командировка»"><button class="btn" data-act="ftAdd">Добавить</button></div></section>
  <section><h2>Автоматические</h2><div class="legend">${auto.map(f => `<span><span class="dot" style="--c:${f.color}"></span>${esc(f.name)}</span>`).join('')}</div><span class="hint">Считаются сами: по производственному календарю, графику мужа и циклу. Мой отпуск и больничный автоматически делают день выходным.</span></section>
  <section><h2>Цикл</h2><div class="card"><b>${ci ? `Сегодня день ${ci.day} из ~${ci.len}` : 'Отметь начало последнего цикла'}</b>
    <div class="row"><input type="date" id="cy-d" class="inp" style="max-width:200px" value="${t}" max="${t}"><button class="btn" data-act="cyAdd">Отметить начало</button></div>
    <span class="hint">${starts.length >= 2 ? `Средняя длина по отметкам: ${cycleLen()} ${plural(cycleLen(), 'день', 'дня', 'дней')}.` : 'После двух отметок посчитаю среднюю длину.'} Признак «Цикл» можно использовать в условиях — например, фитнес «не в цикл».</span>
    ${starts.length ? `<div class="chips">${starts.slice(0, 8).map(d => `<button class="chip" data-act="cyDel" data-v="${d}">${esc(fmtDay(d))} ×</button>`).join('')}</div>` : ''}</div></section>`;
}

on('fmAdd', () => {
  const flag = document.getElementById('fm-flag').value, from = document.getElementById('fm-from').value, to = document.getElementById('fm-to').value || from;
  if (!from) { toast('Укажи дату'); return; }
  if (to < from) { toast('Конец раньше начала'); return; }
  state.flagMarks.push({ id: uid(), flag, from, to, note: document.getElementById('fm-note').value.trim() });
  commit(); toast(`Отмечено: ${flagType(flag).name}, ${diffDays(from, to) + 1} дн.`);
});
on('fmDel', d => { state.flagMarks = state.flagMarks.filter(m => m.id !== d.id); commit(); toast('Отметка снята'); });
on('ftAdd', () => {
  const name = document.getElementById('ft-new').value.trim(); if (!name) return;
  const colors = ['#5B7FD6', '#D9534F', '#3D8B6A', '#E08A1E', '#8B5FBF', '#2A9DB8'];
  state.flagTypes.push({ id: 'f_' + uid().slice(0, 8), name, color: colors[state.flagTypes.length % colors.length] });
  commit(); toast('Признак добавлен');
});
on('ftDel', (d, el) => {
  const used = state.tasks.some(t => JSON.stringify(t.cond || {}).includes(`"${d.id}"`));
  if (!el.dataset.sure) { el.dataset.sure = 1; el.textContent = used ? 'Есть в условиях! Удалить?' : 'Удалить?'; el.style.fontSize = '12px'; el.style.width = 'auto'; return; }
  state.flagTypes = state.flagTypes.filter(f => f.id !== d.id); state.flagMarks = state.flagMarks.filter(m => m.flag !== d.id); commit();
});
on('cyAdd', () => { const v = document.getElementById('cy-d').value; if (!v) return; state.cycleStarts = [...new Set([...state.cycleStarts, v])].sort().slice(-24); commit(); toast('Отмечено. Фитнес на эти дни не ставлю'); });
on('cyDel', d => { state.cycleStarts = state.cycleStarts.filter(x => x !== d.v); commit(); });
on('noop', () => { });

/** Изменения названий и цветов признаков (событие change). */
export function onFlagsChange(e) {
  const n = e.target.dataset.fname, c = e.target.dataset.fcolor;
  if (n) { const f = state.flagTypes.find(x => x.id === n); if (f && e.target.value.trim()) { f.name = e.target.value.trim(); commit(); toast('Сохранено'); } return true; }
  if (c) { const f = state.flagTypes.find(x => x.id === c); if (f) { f.color = e.target.value; commit(); } return true; }
  return false;
}
