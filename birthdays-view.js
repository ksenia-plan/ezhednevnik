// Дни рождения: отдельная вкладка. Дата вводится один раз — напоминания каждый год сами.
import { state, commit, uid } from './core-store.js?v=2.6.3';
import { esc, on, toast, openSheet, closeSheet } from './ui.js?v=2.6.3';
import { dayLabel, plural, addDays } from './core-dates.js?v=2.6.3';
import { nextBirthday } from './birthdays-model.js?v=2.6.3';
import { addTask, newTask } from './tasks-model.js?v=2.6.3';

let editId = null;

export function render() {
  const list = state.birthdays.map(b => ({ b, n: nextBirthday(b) })).sort((a, c) => a.n.in - c.n.in);
  const e = editId ? state.birthdays.find(x => x.id === editId) : null;
  return `<h1>Дни рождения</h1>
  <div class="card"><b>${e ? 'Изменить' : 'Добавить день рождения'}</b>
    <div class="fields"><label class="field">Имя<input id="bd-name" value="${esc(e?.name || '')}" placeholder="Маша"></label><label class="field">Дата<input id="bd-date" type="date" value="${esc(e?.date || '')}"></label></div>
    <div class="fields"><label class="field">Кто это<input id="bd-who" value="${esc(e?.who || '')}" placeholder="подруга, коллега…"></label><label class="field">Предупредить за, дней<input id="bd-warn" value="${esc((e?.warn || [7, 1]).join(', '))}" placeholder="7, 1"></label></div>
    <label class="check-row"><input type="checkbox" id="bd-noyear" ${e?.noYear ? 'checked' : ''}> Год рождения не знаю</label>
    <div class="row"><button class="btn" data-act="bdSave">${e ? 'Сохранить' : 'Добавить'}</button>${e ? '<button class="btn ghost" data-act="bdCancel">Отмена</button><button class="btn danger" data-act="bdDel">Удалить</button>' : ''}</div></div>
  ${list.length ? `<div class="list">${list.map(({ b, n }) => `<div class="it" data-act="bdEdit" data-id="${b.id}" style="cursor:pointer"><div class="tm" style="color:${n.in <= 7 ? 'var(--danger)' : 'var(--muted)'}">${n.in === 0 ? 'сегодня' : n.in + ' дн.'}</div><div class="grow"><div class="t">${esc(b.name)}${n.age ? `, исполнится ${n.age}` : ''}</div><div class="m">${esc(dayLabel(n.ds))}${b.who ? ' · ' + esc(b.who) : ''} · напомню за ${(b.warn || [7, 1]).join(' и ')} ${plural((b.warn || [7, 1]).slice(-1)[0], 'день', 'дня', 'дней')}${(b.greeted || {})[n.ds.slice(0, 4)] ? ' · поздравила ✓' : ''}</div></div>${n.in <= 7 ? `<input type="checkbox" class="check" data-act="bdayDone" data-id="${b.id}" data-ds="${n.ds}" ${(b.greeted || {})[n.ds.slice(0, 4)] ? 'checked' : ''} aria-label="Поздравила">` : '<span></span>'}</div>`).join('')}</div>` : '<div class="empty">Пока пусто. Добавь дату один раз — напоминание будет приходить каждый год.</div>'}`;
}

on('bdSave', () => {
  const name = document.getElementById('bd-name').value.trim(), date = document.getElementById('bd-date').value;
  if (!name || !date) { toast('Укажи имя и дату'); return; }
  const warn = document.getElementById('bd-warn').value.split(/[,\s]+/).map(Number).filter(n => n >= 0 && n <= 60);
  const rec = { name: name.slice(0, 60), date, who: document.getElementById('bd-who').value.trim().slice(0, 60), noYear: document.getElementById('bd-noyear').checked, warn: warn.length ? [...new Set(warn)].sort((a, b) => b - a) : [7, 1] };
  if (editId) Object.assign(state.birthdays.find(x => x.id === editId), rec); else state.birthdays.push({ id: uid(), ...rec });
  editId = null; commit(); toast('Сохранено');
});
on('bdEdit', d => { editId = d.id; window.app.render(); window.scrollTo(0, 0); });
on('bdCancel', () => { editId = null; window.app.render(); });
on('bdDel', (d, el) => { if (!el.dataset.sure) { el.dataset.sure = 1; el.textContent = 'Точно удалить?'; return; } state.birthdays = state.birthdays.filter(x => x.id !== editId); editId = null; commit(); toast('Удалено'); });

/** Задача «подарок» за пару дней до праздника (используется помощником). */
export function giftTask(b) {
  const n = nextBirthday(b);
  addTask(newTask({ title: `Подарок: ${b.name}`, cat: 'family', date: addDays(n.ds, -Math.min(2, Math.max(0, n.in - 1))), important: true, dur: 30 }));
}
