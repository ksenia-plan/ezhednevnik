// Настройки: тема, режим дня, график мужа, резервная копия, перенос из старой версии.
import { state, commit, exportAll, importAll } from './core-store.js';
import { esc, on, toast, copyText, download, openSheet, closeSheet } from './ui.js';
import { today, addDays, WDS, D, fmtDay } from './core-dates.js';
import { husbandShift, SHIFT_NAMES } from './core-flags.js';
import { findOldData, migrateOld } from './settings-migrate.js';

export function render() {
  const st = state.settings, t = today(), old = !state.meta.migratedAt ? findOldData() : null;
  return `<h1>Настройки</h1>
  ${old ? `<div class="card" style="border-color:var(--accent)"><b>Нашла данные прежней версии</b><span class="hint">Задачи, записи на процедуры, дни рождения, дачу и цикл можно перенести сюда.</span><button class="btn" data-act="migrate">Перенести</button></div>` : ''}
  <section><h2>Тема</h2><div class="seg" role="group">${[['auto', 'Как в телефоне'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(([k, n]) => `<button data-act="theme" data-v="${k}" aria-pressed="${st.theme === k}">${n}</button>`).join('')}</div></section>
  <section><h2>Режим дня</h2><div class="card">
    <div class="fields"><label class="field">Подъём в будни<input type="time" data-set="dayStart" value="${esc(st.dayStart)}"></label><label class="field">Отбой в будни<input type="time" data-set="dayEnd" value="${esc(st.dayEnd)}"></label></div>
    <div class="fields"><label class="field">Подъём в выходные<input type="time" data-set="dayStartOff" value="${esc(st.dayStartOff)}"></label><label class="field">Отбой в выходные<input type="time" data-set="dayEndOff" value="${esc(st.dayEndOff)}"></label></div>
    <span class="hint">Свободные окна ищу между подъёмом и отбоем. Рабочее время — это задача «Работа с дорогой» в календаре, её можно изменить.</span></div></section>
  <section><h2>График мужа</h2><div class="card">
    <div class="fields"><label class="field wide">Цикл (Д — дневная, Н — в ночь, СН — с ночи, В — выходной)<input data-set="husband.cycle" value="${esc(st.husband.cycle)}"></label><label class="field">Первый день цикла<input type="date" data-set="husband.anchor" value="${esc(st.husband.anchor)}"></label></div>
    <div class="pills">${[...Array(8)].map((_, i) => { const d = addDays(t, i), h = husbandShift(d), c = { 'Д': '#C98A12', 'Н': '#4650C8', 'СН': '#8A6FB5', 'В': '#2E8B57' }[h]; return `<span class="pill" style="--c:${c}">${WDS[D(d).getDay()]} ${D(d).getDate()}: ${SHIFT_NAMES[h]}</span>`; }).join('')}</div></div></section>
  <section id="backup"><h2>Резервная копия</h2><div class="card">
    <span class="hint">Все данные хранятся только в этом телефоне. Копия нужна, чтобы перенести их на другое устройство или восстановить. ${state.meta.lastBackup ? 'Последняя копия: ' + esc(fmtDay(state.meta.lastBackup.slice(0, 10))) + '.' : 'Копий ещё не было.'}</span>
    <div class="row"><button class="btn" data-act="bkSave">Сохранить копию</button><button class="btn ghost" data-act="bkLoad">Загрузить копию</button></div>
    <div class="fields"><label class="field">Напоминать о копии раз в, дней<input type="number" min="1" max="60" data-set="backupEveryDays" data-num value="${+st.backupEveryDays || 7}"></label></div></div></section>
  <section><h2>О приложении</h2><div class="note"><b>Версия ${esc(window.__appVer || '')}</b>. Работает без интернета. Не обращается к Claude API и не содержит ключей. Данные не отправляются на сторонние серверы. Исключение — голосовой ввод: его распознаёт браузер на серверах Google или Яндекса, и только когда ты нажимаешь «Сказать».</div></section>`;
}

on('theme', d => { state.settings.theme = d.v; applyTheme(); commit(); });
export function applyTheme() { const th = state.settings.theme; if (th === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', th); try { localStorage.setItem('theme-hint', JSON.stringify(th)); } catch (e) { } }
on('migrate', () => { const v = findOldData(); if (!v) return; const r = migrateOld(v); toast(`Перенесено: задач ${r.tasks}, записей ${r.appts}, ДР ${r.birthdays}, дней дачи ${r.dacha}`); });
on('bkSave', async () => {
  const txt = exportAll(); state.meta.lastBackup = new Date().toISOString(); commit();
  const name = `ezhednevnik-${today()}.json`;
  const sh = openSheet(`<h3>Копия данных</h3><span class="hint">Сохрани файл или скопируй текст и отправь себе, например в Telegram «Избранное».</span>
    <textarea id="bk-text" class="inp" rows="5" readonly>${esc(txt)}</textarea>
    <div class="actions"><button class="btn ghost" data-x="close">Закрыть</button><span class="row"><button class="btn ghost" data-x="copy">Скопировать</button><button class="btn" data-x="file">Сохранить файл</button></span></div>`, 'Копия');
  sh.addEventListener('click', async e => { const x = e.target.closest('[data-x]')?.dataset.x; if (x === 'close') closeSheet(); if (x === 'copy') { const ok = await copyText(txt, document.getElementById('bk-text')); toast(ok ? 'Скопировано' : 'Выделила — нажми «Копировать»'); } if (x === 'file') toast(download(name, txt) ? 'Файл сохранён в «Загрузки»' : 'Не получилось — скопируй текст'); });
});
on('bkLoad', () => {
  const sh = openSheet(`<h3>Загрузить копию</h3><span class="hint">Вставь текст копии или выбери файл. Текущие данные на этом устройстве заменятся. Копию прежней версии ежедневника тоже можно загрузить — перенесу.</span>
    <textarea id="bk-in" class="inp" rows="5"></textarea><input type="file" id="bk-file" accept=".json,application/json">
    <div class="actions"><button class="btn ghost" data-x="close">Закрыть</button><button class="btn" data-x="load">Загрузить</button></div>`, 'Загрузить копию');
  sh.addEventListener('change', async e => { if (e.target.id === 'bk-file' && e.target.files[0]) document.getElementById('bk-in').value = await e.target.files[0].text(); });
  sh.addEventListener('click', e => {
    const x = e.target.closest('[data-x]')?.dataset.x; if (x === 'close') closeSheet(); if (x !== 'load') return;
    const txt = document.getElementById('bk-in').value.trim(); if (!txt) return;
    try {
      const v = JSON.parse(txt);
      if (v.app === 'planner') { const r = migrateOld(v); closeSheet(); toast(`Перенесено из прежней версии: задач ${r.tasks}, записей ${r.appts}`); return; }
      importAll(txt); closeSheet(); toast('Данные восстановлены');
    } catch (err) { toast(err.message && err.message.length < 80 ? err.message : 'Это не копия ежедневника'); }
  });
});

/** Поля data-set="a.b" сохраняются по событию change. */
export function onSettingsChange(e) {
  const el = e.target, path = el.dataset.set; if (!path) return false;
  let v = el.value; if (el.hasAttribute('data-num')) v = +v || 0;
  const ks = path.split('.'); let o = state.settings; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = v; commit(); toast('Сохранено'); return true;
}
