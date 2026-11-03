// Календарь — главный экран: виды «день», «неделя», «месяц», навигация и кнопка «Сегодня».
import { state, commit } from './core-store.js?v=2.6.3';
import { esc, on, openSheet, closeSheet, toast, enableDrag } from './ui.js?v=2.6.3';
import { today, addDays, D, iso, WDS, MON, MON1, dayLabel, fmtDay, toMin, fromMin, nowMin, durTxt, weekStart, daysInMonth } from './core-dates.js?v=2.6.3';
import { flagsOf, flagType, husbandShift, SHIFT_NAMES, cycleInfo, dachaIsAuto } from './core-flags.js?v=2.6.3';
import { holidayName } from './core-prodcal.js?v=2.6.3';
import { itemsOn, freeGaps, overdue, slotsAhead, moveOptions, whyNot, afterDay, lastAppt, altOn, itemTitle, rotZone, itemColor, planDate } from './core-occur.js?v=2.6.3';
import { cat } from './core-seed.js?v=2.6.3';
import { describeRule } from './core-recur.js?v=2.6.3';
import { describeCond } from './core-cond.js?v=2.6.3';
import { setDone, moveItem, skipItem, getTask, updateTask, deleteTask } from './tasks-model.js?v=2.6.3';
import { openEditor } from './tasks-editor.js?v=2.6.3';
import { nextBirthday } from './birthdays-model.js?v=2.6.3';
import { suggestionsHtml, slotChip } from './assistant-suggest.js?v=2.6.3';
import { allPurchases } from './shop-view.js?v=2.6.3';
import { markDay } from './flags-view.js?v=2.6.3';
import { bookingOptions, ruleFor, planFor, comboDays, apptMoveOptions, apptWhyNot, apptGap } from './core-booking.js?v=2.6.3';

export const cal = { view: 'day', day: today(), q: '' };

// какие признаки показывать на карточке дня (остальные — внутренние)
const SHOW_AUTO = ['my_off', 'holiday', 'short_day', 'h_day', 'h_night', 'h_after', 'h_off', 'common_off', 'cycle'];
function dayFlags(ds) {
  const f = flagsOf(ds);
  return state.flagTypes.filter(t => f.has(t.id) && (!t.auto || SHOW_AUTO.includes(t.id)));
}
/** Главный признак дня — им закрашивается фон дня: больничный, отпуск, дача, донор, праздник, каникулы, поездка, выходной, рабочий. */
// свой цвет фона для выходного (тёплый), чтобы не путался с дачей (зелёный) и рабочим днём (голубой)
const TONE = [['sick', 26], ['vac_me', 22], ['dacha', 24], ['dacha_eve', 14], ['donor', 18], ['holiday', 20], ['kids_hol', 14], ['trip', 18], ['common_off', 20, '#D99A1E'], ['my_off', 20, '#D99A1E'], ['my_work', 8]];
export function dayTone(ds) {
  const f = flagsOf(ds);
  for (const [id, pct, col] of TONE) if (f.has(id)) { const t = state.flagTypes.find(x => x.id === id); if (t) return { color: col || t.color, pct, name: t.name }; }
  return null;
}
const toneStyle = (ds, extra = 0) => { const t = dayTone(ds); return t ? `--tone:${t.color};--tp:${t.pct + extra}%` : ''; };
function pillsInline(ds) {
  const hol = holidayName(ds);
  return dayFlags(ds).map(t => `<span class="pill" style="--c:${t.color}">${esc(t.id === 'holiday' && hol ? hol : t.id === 'cycle' ? 'Цикл · день ' + cycleInfo(ds).day : t.name)}</span>`).join('');
}
/** «Сейчас / Дальше» — что идёт и что следующее (только сегодня). */
function nowNext(items) {
  const n = nowMin(), tm = items.filter(i => i.task && i.time && !i.done && !i.task.info);
  const cur = tm.find(i => toMin(i.time) <= n && n < toMin(i.time) + i.dur);
  const nxt = tm.find(i => toMin(i.time) > n) || null;
  if (!cur && !nxt) return '';
  const row = (lbl, i) => `<div class="nn-row" data-act="item" data-id="${i.task.id}" data-orig="${i.orig}" data-ds="${i.ds}" style="--c:${itemColor(i, cat(i.task.cat).color)}"><span class="nn-l">${lbl}</span><b>${i.time}</b><span class="nn-t">${esc(itemTitle(i))}${lbl === 'Дальше' ? `<small class="hint"> · через ${durTxt(toMin(i.time) - n)}</small>` : ''}</span></div>`;
  return `<div class="nownext">${cur ? row('Сейчас', cur) : ''}${nxt ? row('Дальше', nxt) : ''}</div>`;
}
function pillsHtml(ds) {
  const hol = holidayName(ds);
  return `<div class="pills">${dayFlags(ds).map(t => `<span class="pill" style="--c:${t.color}">${esc(t.id === 'holiday' && hol ? hol : t.id === 'cycle' ? 'Цикл · день ' + cycleInfo(ds).day : t.name)}</span>`).join('')}${flagsOf(ds).has('my_work') ? '<span class="pill" style="--c:#2C64C6">Рабочий день</span>' : ''}</div>`;
}

function head0(open = false) {
  const v = cal.view;
  return `<div class="cal-head"><div class="row between"><div class="seg" role="group" aria-label="Вид календаря">${[['day', 'День'], ['week', 'Неделя'], ['month', 'Месяц'], ['list', 'Дела']].map(([k, n]) => `<button data-act="calView" data-v="${k}" aria-pressed="${v === k}">${n}</button>`).join('')}</div>${v === 'list' ? '' : '<button class="btn ghost small" data-act="calToday">Сегодня</button>'}</div>${open ? '' : '</div>'}`;
}
/** Вид «Дела»: все повторяющиеся дела и их ближайшие даты сразу на экране. */
function seriesList() {
  const t0 = today(), next = new Map();
  for (let i = 0; i < 62; i++) { const ds = addDays(t0, i); for (const it of itemsOn(ds)) if (it.task && it.task.kind === 'repeat' && !it.task.block && !it.done) { const a = next.get(it.task) || []; a.push(it); next.set(it.task, a); } }
  const q = (cal.q || '').toLowerCase().trim();
  const tasks = state.tasks.filter(t => t.kind === 'repeat' && !t.archived && !t.block && (!q || t.title.toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q)));
  const order = t => (t.info ? 3 : t.booking ? 2 : t.rule?.freq === 'daily' ? 1 : 0); // сначала фитнес, уборка, счета; ежедневное — ниже
  tasks.sort((a, b) => order(a) - order(b) || ((next.get(a) || [])[0]?.ds || '9').localeCompare((next.get(b) || [])[0]?.ds || '9'));
  const card = t => { const its = next.get(t) || []; if (t.booking) { const o = bookingOptions(t, 3); return `<div class="card" style="gap:6px"><div class="row between"><b><button class="x" data-act="fav" data-id="${t.id}" aria-label="${t.fav ? 'Убрать из избранного' : 'В избранное'}" style="color:${t.fav ? 'var(--warn)' : 'var(--muted)'}">${t.fav ? '★' : '☆'}</button><span class="dot" style="--c:${cat(t.cat).color}"></span> ${esc(t.title)}</b><span class="hint">${lastAppt(t) ? 'запись ' + esc(fmtDay(lastAppt(t))) + ' · ' : ''}следующая ~ ${esc(afterDay(t) ? fmtDay(afterDay(t)) : '—')}</span></div><span class="hint">${esc(describeRule(t))}${ruleFor(t).why ? ' · окна ' + esc(ruleFor(t).why) : ''}</span>${planHtml(t)}</div>`; } return `<div class="card" data-act="series" data-id="${t.id}" style="cursor:pointer;gap:6px"><div class="row between"><b><button class="x" data-act="fav" data-id="${t.id}" aria-label="${t.fav ? 'Убрать из избранного' : 'В избранное'}" style="color:${t.fav ? 'var(--warn)' : 'var(--muted)'}">${t.fav ? '★' : '☆'}</button><span class="dot" style="--c:${cat(t.cat).color}"></span> ${esc(t.title)}</b><span class="hint">${its.length} раз за 2 месяца ›</span></div><span class="hint">${esc(describeRule(t))}</span>${its.length ? `<div class="chips sm">${its.slice(0, 6).map(i => `<span class="chip"${t.colorWk ? ` style="background:color-mix(in srgb,${itemColor(i, '')} 18%,var(--surface));border-color:${itemColor(i, '')}"` : ''}>${WDS[D(i.ds).getDay()]} ${D(i.ds).getDate()}.${String(D(i.ds).getMonth() + 1).padStart(2, '0')}${i.time ? ' · ' + i.time : ''}${rotZone(t, i.orig) ? ' · ' + esc(rotZone(t, i.orig).toLowerCase()) : ''}</span>`).join('')}${its.length > 6 ? '<span class="chip">ещё…</span>' : ''}</div>` : '<span class="hint">Ближайших дат нет</span>'}</div>`; };
  const sport = tasks.filter(t => t.group === 'sport');
  const sportCard = () => { if (!sport.length) return ''; const its = sport.flatMap(t => (next.get(t) || []).map(i => ({ i, t }))).sort((a, b) => a.i.ds < b.i.ds ? -1 : 1);
    const max = Math.max(...sport.map(t => +t.rule?.perWeek || 0)), s0 = sport[0];
    return `<div class="card" data-act="series" data-id="${s0.id}" style="gap:6px;cursor:pointer"><div class="row between"><b><button class="x" data-act="fav" data-id="${s0.id}" style="color:${s0.fav ? 'var(--warn)' : 'var(--muted)'}">${s0.fav ? '★' : '☆'}</button> 🏃 Спорт</b><span class="hint">${its.length} раз за 2 месяца ›</span></div>
    <span class="hint"><span class="dot" style="--c:#2E8B57"></span> будни — фитнес ${((s0.dur || 90) / 60).toString().replace('.', ',')} ч · <span class="dot" style="--c:#2F7FD0"></span> выходные — ${((s0.durOff || s0.dur || 150) / 60).toString().replace('.', ',')} ч (падел или фитнес) · не больше ${max} в неделю</span>
    <div class="chips sm">${its.slice(0, 10).map(({ i }) => { const c = itemColor(i, '#2E8B57'); return `<span class="chip" style="background:color-mix(in srgb,${c} 18%,var(--surface));border-color:${c}">${WDS[D(i.ds).getDay()]} ${D(i.ds).getDate()}.${String(D(i.ds).getMonth() + 1).padStart(2, '0')}${i.time ? ' · ' + i.time : ''}</span>`; }).join('')}${its.length > 10 ? '<span class="chip">ещё…</span>' : ''}</div></div>`; };
  const favs = tasks.filter(t => t.fav && t.group !== 'sport'), rest = tasks.filter(t => !t.fav && t.group !== 'sport');
  const main = rest.filter(t => !t.info && !t.booking), book = rest.filter(t => t.booking), info = rest.filter(t => t.info);
  const FLAGS_SHOWN = ['dacha', 'dacha_eve', ...state.flagTypes.filter(f => !f.auto && f.id !== 'dacha').map(f => f.id), 'common_off', 'cycle'];
  const dayCard = id => { const f = flagType(id); if (!f) return ''; const ds = []; for (let i = 0; i < 62; i++) { const d = addDays(t0, i); if (flagsOf(d).has(id)) ds.push(d); }
    return `<div class="card" data-act="flagDays" data-id="${id}" style="cursor:pointer;gap:6px"><div class="row between"><b><span class="dot" style="--c:${f.color}"></span> ${esc(f.name)}</b><span class="hint">${ds.length} дн. за 2 месяца ›</span></div>${ds.length ? `<div class="chips sm">${ds.slice(0, 8).map(d => `<span class="chip">${WDS[D(d).getDay()]} ${D(d).getDate()}.${String(D(d).getMonth() + 1).padStart(2, '0')}</span>`).join('')}${ds.length > 8 ? '<span class="chip">ещё…</span>' : ''}</div>` : '<span class="hint">В ближайшие 2 месяца нет</span>'}</div>`; };
  const daysHtml = q ? '' : `<h2>📅 Особые дни — дача, отпуска, цикл</h2>${FLAGS_SHOWN.map(dayCard).join('')}`;
  return `<input id="ser-q" class="inp" type="search" placeholder="Найти дело: спорт, маникюр, уборка…" value="${esc(cal.q || '')}"><span class="hint">Здесь все регулярные дела и когда они стоят на 2 месяца вперёд. Нажми на дело — все даты: перенести, пропустить, изменить.</span>${q && !tasks.length ? '<div class="empty">Ничего не нашлось.</div>' : ''}
  ${favs.length || sport.length ? `<h2>★ Главное — закреплено</h2>${sportCard()}${favs.map(card).join('')}<h2>🔁 Несколько раз в неделю или в месяц</h2>` : ''}${main.filter(t => order(t) === 0).map(card).join('')}${main.some(t => order(t) === 1) ? '<h2>☀️ Каждый день</h2>' + main.filter(t => order(t) === 1).map(card).join('') : ''}${book.some(t => t.cat === 'beauty') ? `<h2>💅 Красота — записи и план на 3 месяца</h2>${book.filter(t => t.cat === 'beauty').map(card).join('')}` : ''}${book.some(t => t.cat !== 'beauty') ? `<h2>🩺 Врачи и анализы — когда записаться</h2>${book.filter(t => t.cat !== 'beauty').map(card).join('')}` : ''}${info.length ? `<h2>👧 Занятия детей — для сведения, твоё время не занимают</h2>${info.map(card).join('')}` : ''}${daysHtml}`;
}

export function render() {
  const v = cal.view;
  let title = '';
  if (v === 'day') title = cal.day === today() ? 'Сегодня, ' + dayLabel(cal.day).toLowerCase() : dayLabel(cal.day);
  if (v === 'week') { const m = weekStart(cal.day), s = addDays(m, 6); title = `${D(m).getDate()} ${MON[D(m).getMonth()]} — ${D(s).getDate()} ${MON[D(s).getMonth()]}`; }
  if (v === 'month') { const d = D(cal.day); title = `${MON1[d.getMonth()]} ${d.getFullYear()}`; }
  if (v === 'list') return head0() + seriesList();
  const head = head0(true) + `<div class="cal-nav"><button class="icon-btn" data-act="calNav" data-d="-1" aria-label="Назад">‹</button><div class="title">${esc(title)}</div><button class="icon-btn" data-act="calNav" data-d="1" aria-label="Вперёд">›</button></div></div>`;
  return head + (v === 'day' ? dayView(cal.day) : v === 'week' ? weekView() : monthView());
}

/* ---------- день ---------- */
function itemRow(i, ds) {
  if (i.bday) { const n = nextBirthday(i.bday, ds), g = !!(i.bday.greeted || {})[ds.slice(0, 4)]; return `<div class="it bday fix ${g ? 'done' : ''}" style="--c:var(--danger)"><div class="tm">ДР</div><div class="bd" style="--c:var(--danger)" data-act="openTab" data-v="birthdays"><div class="t">🎂 ${esc(i.bday.name)}${n.age ? ', ' + n.age : ''}</div><div class="m">${g ? 'поздравила ✓' : 'отметь, когда поздравишь'}</div></div><input type="checkbox" class="check" data-act="bdayDone" data-id="${i.bday.id}" data-ds="${ds}" ${g ? 'checked' : ''} aria-label="Поздравила: ${esc(i.bday.name)}"></div>`; }
  if (i.sub) return `<div class="it sub ${i.done ? 'done' : ''}"><div class="tm">${i.sub.before ? 'за ' + i.sub.before + ' дн.' : 'в тот же день'}</div><div class="bd" style="--c:${cat(i.task.cat).color}" data-act="editTask" data-id="${i.task.id}"><div class="t">${esc(i.sub.title)}</div><div class="m">подзадача для «${esc(i.task.title)}» · ${esc(fmtDay(planDate(i.task)))}</div></div><input type="checkbox" class="check" data-act="subDone" data-id="${i.task.id}" data-sub="${i.sub.id}" ${i.done ? 'checked' : ''} aria-label="Сделано: ${esc(i.sub.title)}"></div>`;
  const t = i.task, c = itemColor(i, cat(t.cat).color), now = ds === today() && i.time && nowMin() >= toMin(i.time) && nowMin() < toMin(i.time) + i.dur;
  const cls = ['it', t.kind === 'repeat' && !i.moved ? 'rep' : 'fix', (t.group === 'sport' || t.colorWk) ? 'sport' : '', i.done ? 'done' : '', t.info ? 'info' : '', t.block ? 'block' : '', now ? 'now' : ''].join(' ');
  const end = i.time ? fromMin(toMin(i.time) + i.dur) : '';
  const meta = [i.withWalk ? '🚶 гуляем вместе — не забудьте пройтись, отдельной прогулки сегодня нет' : '', i.late ? 'приезжаю позже — после сдачи крови' : '', i.moved ? '📌 перенесено вручную с ' + fmtDay(i.orig) : (t.kind === 'repeat' && (t.moveTimes || {})[i.orig] ? '📌 время закреплено' : ''), i.shifted ? 'время сдвинуто: было занято' : '', i.noSlot ? 'не нашлось свободного времени — перенеси' : '', i.conflict ? '⚠ пересекается с «' + i.conflict + '»' : '', t.important || t.urgent ? (t.important ? 'важно' : '') + (t.important && t.urgent ? ', ' : '') + (t.urgent ? 'срочно' : '') : ''].filter(Boolean);
  return `<div class="${cls}"><div class="tm">${i.time || '—'}${end ? `<small>${end}</small>` : ''}</div><div class="bd" style="--c:${c}" data-act="item" data-id="${t.id}" data-orig="${i.orig}" data-ds="${ds}"><div class="t">${esc(itemTitle(i))}</div>${meta.length ? `<div class="m">${meta.map(esc).join(' · ')}</div>` : ''}</div>${t.block || t.info ? '<span></span>' : `<input type="checkbox" class="check" data-act="done" data-id="${t.id}" data-orig="${i.orig}" ${i.done ? 'checked' : ''} aria-label="Сделано: ${esc(t.title)}">`}</div>`;
}
function dayView(ds) {
  const items = itemsOn(ds);
  const timed = items.filter(i => i.time), untimed = items.filter(i => !i.time);
  const gaps = freeGaps(ds, 30);
  const rows = [...timed.map(i => ({ s: toMin(i.time), h: itemRow(i, ds) })), ...gaps.map(g => ({ s: g[0], h: `<div class="it gap"><div class="tm">${fromMin(g[0])}<small>${fromMin(g[1])}</small></div><div class="bd" data-act="gap" data-ds="${ds}" data-s="${g[0]}" data-e="${g[1]}" role="button" tabindex="0"><div class="t">+ Свободно ${durTxt(g[1] - g[0])}</div></div><span></span></div>` }))].sort((a, b) => a.s - b.s);
  const od = ds === today() ? overdue() : [];
  const manual = state.flagTypes.filter(f => !f.auto);
  const favNext = state.tasks.filter(t => t.fav && !t.archived).map(t => { for (let i = 0; i < 62; i++) { const d = addDays(ds < today() ? today() : ds, i); const it = itemsOn(d).find(x => x.task === t && !x.done); if (it) return { t, it }; } return { t, it: null }; });
  const favHtml = favNext.map(({ t, it }) => `<button class="chip" data-act="series" data-id="${t.id}">★ ${esc(t.title)}: ${it ? esc(fmtDay(it.ds)) + (it.time ? ' ' + it.time : '') : '—'}</button>`).join('');
  // одна строка с прокруткой вбок: признаки дня, ссылки на планы, избранное — чтобы план дня был на первом экране
  const buyN = ds === today() ? allPurchases().filter(p => !p.done && p.due && p.due <= ds).length : 0;
  const strip = `<div class="hscroll">${pillsInline(ds)}${buyN ? `<button class="chip" data-act="nav" data-v="shop">🛒 Купить: ${buyN} ›</button>` : ''}${planLinks(ds, true)}${favHtml}</div>`;
  const odHtml = od.length ? `<details class="od"><summary>⚠ Просрочено: ${od.length} — ${esc(od.slice(0, 2).map(t => t.title).join(', '))}${od.length > 2 ? '…' : ''}</summary><div class="list">${od.map(t => `<div class="it"><div class="tm" style="color:var(--danger)">${esc(fmtDay(t.date))}</div><div class="bd" style="--c:${cat(t.cat).color}" data-act="item" data-id="${t.id}" data-orig="${t.date}" data-ds="${t.date}"><div class="t">${esc(t.title)}</div></div><button class="btn ghost small" data-act="toToday" data-id="${t.id}">На сегодня</button></div>`).join('')}</div></details>` : '';
  return `<div class="daytone" style="${toneStyle(ds)}">${dayTone(ds) ? `<div class="tonebar">${esc(dayTone(ds).name)}</div>` : ''}${strip}
  ${ds === today() ? nowNext(items) : ''}
  <section><h2>План дня</h2>${rows.length ? `<div class="list">${rows.map(r => r.h).join('')}</div>` : '<div class="empty">На этот день ничего не запланировано.</div>'}</section>
  ${altHtml(ds)}
  ${untimed.filter(i => !(i.task && i.task.booking)).length ? `<section><h2>Без времени</h2><div class="list">${untimed.filter(i => !(i.task && i.task.booking)).map(i => itemRow(i, ds)).join('')}</div></section>` : ''}
  ${untimed.some(i => i.task && i.task.booking) ? `<div class="chips sm"><span class="hint">Пора записаться:</span>${untimed.filter(i => i.task && i.task.booking).map(i => `<button class="chip" data-act="item" data-id="${i.task.id}" data-orig="${i.orig}" data-ds="${ds}">📅 ${esc(i.task.title.replace(/^Записаться:\s*/i, ''))}</button>`).join('')}</div>` : ''}
  ${odHtml}
  ${ds === today() ? suggestionsHtml(3) : ''}
  <section><h2>Отметить день</h2><div class="chips sm">${manual.map(f => `<button class="chip" data-act="markDay" data-flag="${f.id}" data-ds="${ds}" aria-pressed="${flagsOf(ds).has(f.id)}"><span class="dot" style="--c:${f.color}"></span> ${esc(f.name)}</button>`).join('')}</div></section></div>`;
}

/* ---------- неделя: колонки ---------- */
function weekView() {
  const m = weekStart(cal.day);
  const cols = [...Array(7)].map((_, k) => {
    const ds = addDays(m, k), items = itemsOn(ds).filter(i => !(i.task && i.task.block));
    const bars = dayFlags(ds).map(f => `<i style="--c:${f.color}" title="${esc(f.name)}"></i>`).join('');
    return `<div class="wcol toned ${ds === today() ? 'today' : ''} ${ds === cal.day ? 'sel' : ''}" style="${toneStyle(ds)}" data-drop="${ds}"><div class="wh" data-act="openDay" data-ds="${ds}"><b>${WDS[D(ds).getDay()]}, ${D(ds).getDate()}</b><div class="bars">${bars}</div><span class="hint">${flagsOf(ds).has('my_work') ? 'работа' : 'выходной'} · муж: ${SHIFT_NAMES[husbandShift(ds)]}</span></div>
    <div class="wb" data-act="openDay" data-ds="${ds}">${altOn(ds).map(a => `<div class="wi alt" style="--c:${cat(a.task.cat).color}" data-act="altPick" data-id="${a.task.id}" data-ds="${ds}" data-time="${a.time}"><b>${a.time}</b>${esc(a.task.title)}? можно</div>`).join('')}${items.map(i => i.bday ? `<div class="wi fix ${(i.bday.greeted || {})[ds.slice(0, 4)] ? 'done' : ''}" style="--c:var(--danger)">🎂 ${esc(i.bday.name)}</div>` : i.sub ? `<div class="wi fix sub ${i.done ? 'done' : ''}" style="--c:${cat(i.task.cat).color}" data-act="editTask" data-id="${i.task.id}">↳ ${esc(i.sub.title)}</div>` : `<div class="wi ${i.done ? 'done' : ''} ${i.task.kind === 'repeat' && !i.moved ? 'rep' : 'fix'} ${(i.task.group === 'sport' || i.task.colorWk) ? 'sport' : ''}" style="--c:${itemColor(i, cat(i.task.cat).color)}" data-act="item" data-id="${i.task.id}" data-orig="${i.orig}" data-ds="${ds}" ${i.task.info ? '' : `data-drag="${i.task.id}|${i.orig}"`} data-drag-label="${esc(i.task.title)}">${i.time ? `<b>${i.time}</b>` : ''}${esc(itemTitle(i))}</div>`).join('') || '<span class="hint">—</span>'}</div></div>`;
  }).join('');
  return `<div class="week" id="week">${cols}</div><span class="hint">Удерживай дело и перетащи на другой день, чтобы перенести. Нажми на заголовок — откроется день.</span>${legendHtml()}`;
}

/* ---------- месяц ---------- */
function monthView() {
  const d = D(cal.day), y = d.getFullYear(), mo = d.getMonth() + 1;
  const first = `${y}-${String(mo).padStart(2, '0')}-01`, lead = (D(first).getDay() + 6) % 7, n = daysInMonth(y, mo);
  let h = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(x => `<div class="wn">${x}</div>`).join('');
  for (let i = 0; i < lead; i++) h += '<div></div>';
  for (let i = 1; i <= n; i++) {
    const ds = `${y}-${String(mo).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    const items = itemsOn(ds).filter(x => x.bday || (!x.task.block && !x.task.info));
    const cats = [...new Set(items.map(x => x.bday ? 'var(--danger)' : cat(x.task.cat).color))].slice(0, 6);
    h += `<button class="mc toned ${ds === today() ? 'today' : ''} ${ds === cal.day ? 'sel' : ''}" style="${toneStyle(ds, 4)}" data-act="openDay" data-ds="${ds}" aria-label="${dayLabel(ds)}"><span class="n">${i}</span><span class="bars">${dayFlags(ds).filter(f => f.id !== 'my_off').map(f => `<i style="--c:${f.color}"></i>`).join('')}</span><span class="dots">${cats.map(c => `<span class="dot" style="--c:${c}"></span>`).join('')}</span></button>`;
  }
  return `<div class="month">${h}</div>${legendHtml()}`;
}
function legendHtml() {
  const shown = state.flagTypes.filter(f => ['h_day', 'h_night', 'h_after', 'h_off', 'common_off', 'cycle', 'holiday'].includes(f.id) || !f.auto);
  return `<details><summary>Цвета</summary><div class="legend" style="margin-top:8px">${shown.map(f => `<span><span class="dot" style="--c:${f.color}"></span>${esc(f.name)}</span>`).join('')}</div></details>`;
}

/* ---------- действия ---------- */
on('calView', d => { cal.view = d.v; window.app.render(); });
on('calToday', () => { cal.day = today(); window.app.render(); });
on('calNav', d => { const n = +d.d; if (cal.view === 'day') cal.day = addDays(cal.day, n); else if (cal.view === 'week') cal.day = addDays(cal.day, 7 * n); else { const x = D(cal.day); x.setDate(1); x.setMonth(x.getMonth() + n); cal.day = iso(x); } window.app.render(); });
on('openDay', d => { cal.view = 'day'; cal.day = d.ds; window.app.go('calendar'); window.scrollTo(0, 0); });
on('subDone', (d, el) => { const t = getTask(d.id); const sb = t && (t.subs || []).find(x => x.id === d.sub); if (!sb) return; sb.done = el.checked; commit(); toast(el.checked ? 'Подзадача сделана' : 'Вернула в работу'); });
on('done', (d, el) => { const t = getTask(d.id); if (t) setDone(t, d.orig, el.checked); });
on('bdayDone', (d, el) => { const b = state.birthdays.find(x => x.id === d.id); if (!b) return; const y = d.ds.slice(0, 4); b.greeted = { ...(b.greeted || {}), [y]: el.checked }; if (!el.checked) delete b.greeted[y]; commit(); toast(el.checked ? `${b.name}: поздравила ✓` : 'Отметка снята'); });
on('toToday', d => { const t = getTask(d.id); moveItem(t, t.date, today()); toast('Перенесено на сегодня'); });
on('markDay', d => markDay(d.flag, d.ds));
on('item', (d, el) => { if (el.dataset.justDragged) return; itemSheet(d.id, d.orig, d.ds); });
on('gap', d => gapSheet(d.ds, +d.s, +d.e));

/** Лист действий для пункта: выполнено, перенести, пропустить, изменить. */
export function itemSheet(id, orig, ds) {
  const t = getTask(id); if (!t) return;
  const rep = t.kind === 'repeat';
  const it = itemsOn(ds).find(i => i.task === t && i.orig === orig) || { time: t.time, done: false };
  const slots = apptMoveOptions(t, 6) || moveOptions(t, orig, 6, today());
  const sh = openSheet(`<h3>${esc(t.title)}</h3><span class="hint">${esc(dayLabel(ds))}${it.time ? ', ' + it.time : ''}${rep ? ' · ' + esc(describeRule(t)) : ''}</span>
  ${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}
  ${rep ? `<button class="btn ghost small" data-act="fav" data-id="${t.id}">${t.fav ? '★ В избранном — убрать' : '☆ В избранное'}</button>` : ''}
  ${t.booking ? (() => { const o = bookingOptions(t, 4); return `${/маникюр|педикюр|брови|стрижк/i.test(t.title) ? `<h2>План записей</h2>${planHtml(t)}<h2>Другие окна для ближайшей записи</h2>` : '<h2>Окна для записи</h2>'}<span class="hint">${esc(ruleFor(t).why || '')}</span>${o.length ? `<div class="chips">${o.map(x => slotChip(x, '', true)).join('')}</div>` : '<span class="hint">Свободных окон по правилам в ближайший месяц нет.</span>'}`; })() : (rep ? '<button class="btn ghost" data-x="all">📅 Все даты этого дела</button>' : '')}
  ${t.block || t.info ? '' : `<button class="btn" data-x="done">${it.done ? 'Вернуть в работу' : 'Сделано'}</button>`}
  <h2>Перенести${rep ? ' только этот раз' : ''}</h2>
  ${tomorrowWhy(t, ds, slots)}
  ${slots.length ? `<span class="hint">Подходящие дни — свободно и по условиям дела${t.cond ? ' (' + esc(describeCond(t.cond)) + ')' : ''}:</span><div class="chips">${slots.map(s => { const g = apptGap(t, s.ds); const m = /увеличен на (\d+)|сокращён на (\d+)/.exec(g); return `<button class="chip" data-x="slot" data-v="${s.ds}|${s.time}">${esc(fmtDay(s.ds))}, ${s.time}${m ? (m[1] ? ` (+${m[1]} дн.)` : ` (−${m[2]} дн.)`) : ''}</button>`; }).join('')}</div>` : '<span class="hint">В ближайшие 4 недели подходящих свободных дней нет — выбери день вручную.</span>'}
  <div class="warnline" id="mv-warn" hidden></div>
  <div class="fields"><label class="field">День<input type="date" id="mv-d" value="${ds}"></label><label class="field">Время<input type="time" id="mv-t" value="${esc(it.time || '')}"></label></div>${apptGap(t, ds) ? `<span class="hint" id="mv-gap">Сейчас: ${esc(apptGap(t, ds))}</span>` : ''}
  <div class="actions"><span class="row">${rep ? '<button class="btn ghost" data-x="skip">Пропустить раз</button>' : ''}<button class="btn ghost" data-x="edit">${rep ? 'Изменить всю серию' : 'Изменить'}</button><button class="btn ghost danger" data-x="del">${rep ? 'Удалить всю серию' : 'Удалить'}</button></span><span class="row"><button class="btn ghost" data-x="close">Закрыть</button><button class="btn" data-x="move">Перенести</button></span></div>`, 'Дело');
  sh.addEventListener('input', e => { if (e.target.id === 'mv-d') { const g = apptGap(t, e.target.value), el = document.getElementById('mv-gap'); if (el) el.textContent = g ? 'Если перенести: ' + g : ''; } });
  sh.addEventListener('click', e => {
    const b = e.target.closest('[data-x]'); if (!b) return;
    const x = b.dataset.x;
    if (x === 'close') closeSheet();
    if (x === 'done') { setDone(t, orig, !it.done); closeSheet(); toast(it.done ? 'Вернула в работу' : 'Отмечено'); }
    if (x === 'to') { moveItem(t, orig, b.dataset.v); closeSheet(); toast('Перенесено на ' + fmtDay(b.dataset.v)); }
    if (x === 'slot') { const [dd, tt] = b.dataset.v.split('|'); moveItem(t, orig, dd, tt); closeSheet(); toast(`Перенесено: ${fmtDay(dd)}, ${tt}. Закреплено`); }
    if (x === 'move') {
      const dd = document.getElementById('mv-d').value || ds, tt = document.getElementById('mv-t').value;
      const why = dd !== ds ? (apptWhyNot(t, dd) || whyNot(t, dd)) : '';
      if (why && !b.dataset.sure) { const w = document.getElementById('mv-warn'); w.hidden = false; w.textContent = 'Внимание: ' + why + '. Нажми ещё раз, если всё равно переносишь.'; b.dataset.sure = 1; b.textContent = 'Всё равно перенести'; return; }
      moveItem(t, orig, dd, tt || null); closeSheet(); toast('Перенесено и закреплено — приложение его не сдвинет');
    }
    if (x === 'skip') { skipItem(t, orig); closeSheet(); toast('Пропущено'); }
    if (x === 'edit') { closeSheet(); openEditor(t.id); }
    if (x === 'del') { if (b.dataset.sure) { deleteTask(t.id); closeSheet(); toast('Удалено'); } else { b.dataset.sure = 1; b.textContent = 'Точно удалить?'; } }
    if (x === 'all') { closeSheet(); seriesSheet(t.id); }
  });
}

/** Свободное окно: поставить сюда задачу без времени или новую. */
function gapSheet(ds, s, e) {
  const len = e - s;
  const cand = state.tasks.filter(t => !t.archived && t.kind === 'once' && !t.done && !t.time && (!t.date || t.date <= ds) && (+t.dur || 30) <= len)
    .sort((a, b) => (b.important - a.important) || (b.urgent - a.urgent)).slice(0, 8);
  const sh = openSheet(`<h3>${esc(dayLabel(ds))}, ${fromMin(s)}–${fromMin(e)}</h3><span class="hint">Свободно ${durTxt(len)}. Выбери дело — поставлю на ${fromMin(s)}.</span>
  ${cand.length ? `<div class="list">${cand.map(t => `<div class="it"><span class="dot" style="--c:${cat(t.cat).color}"></span><div class="grow"><div class="t">${esc(t.title)}</div><div class="m">${durTxt(+t.dur || 30)}${t.date ? ' · ' + esc(fmtDay(t.date)) : ' · без даты'}</div></div><button class="btn small" data-x="put" data-id="${t.id}">Сюда</button></div>`).join('')}</div>` : '<span class="hint">Подходящих дел без времени нет.</span>'}
  <div class="actions"><button class="btn ghost" data-x="close">Закрыть</button><button class="btn" data-x="new">Новое дело на ${fromMin(s)}</button></div>`, 'Свободное окно');
  sh.addEventListener('click', ev => {
    const b = ev.target.closest('[data-x]'); if (!b) return;
    if (b.dataset.x === 'close') closeSheet();
    if (b.dataset.x === 'put') { updateTask(b.dataset.id, { date: ds, time: fromMin(s) }); closeSheet(); toast('Поставила на ' + fromMin(s)); }
    if (b.dataset.x === 'new') { closeSheet(); openEditor(null, { date: ds, time: fromMin(s), dur: Math.min(60, len) }); }
  });
}

/** Перетаскивание в неделе: id|orig → день. */
export function bindWeekDrag(root) {
  enableDrag(root, (key, ds) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ds) || !key.includes('|')) return; // только неделя: дело|дата → день
    const [id, orig] = key.split('|'); const t = getTask(id); if (!t) return;
    if (!t.date && t.kind === 'once') { updateTask(id, { date: ds }); toast('Поставила на ' + fmtDay(ds)); return; }
    moveItem(t, orig, ds); toast('Перенесено на ' + fmtDay(ds));
  });
}

/** Все будущие даты задачи на 2 месяца вперёд — «когда я пойду на фитнес». */
export function seriesSheet(id) {
  const t = getTask(id); if (!t) return;
  const t0 = today(), rows = [];
  for (let i = 0; i < 62; i++) {
    const ds = addDays(t0, i);
    for (const it of itemsOn(ds)) if (it.task === t) rows.push(it);
  }
  const skipped = Object.keys(t.skip || {}).filter(d => d >= t0).sort();
  let mo = '';
  const list = rows.map(it => {
    const m = it.ds.slice(0, 7); const head = m !== mo ? (mo = m, `<div class="mo">${MON1[+m.slice(5) - 1]} ${m.slice(0, 4)}</div>`) : '';
    const end = it.time ? fromMin(toMin(it.time) + it.dur) : '';
    return head + `<div class="it ${it.done ? 'done' : ''}"><div class="tm">${it.time || '—'}${end ? `<small>${end}</small>` : ''}</div><div class="bd" style="--c:${cat(t.cat).color}" data-y="open" data-orig="${it.orig}" data-ds="${it.ds}"><div class="t">${esc(dayLabel(it.ds))}${rotZone(t, it.orig) ? ' — ' + esc(rotZone(t, it.orig).toLowerCase()) : ''}</div><div class="m">${[it.moved ? 'перенесено с ' + fmtDay(it.orig) : '', it.shifted ? 'время сдвинуто в свободное окно' : '', it.done ? 'сделано' : ''].filter(Boolean).map(esc).join(' · ')}</div></div><span></span></div>`;
  }).join('');
  const sh = openSheet(`<h3>${esc(t.title)}</h3><span class="hint">${t.kind === 'repeat' ? esc(describeRule(t)) : 'разовое дело'} · ближайшие 2 месяца: ${rows.length}</span>
  ${rows.length ? `<div class="list">${list}</div>` : '<div class="empty">В ближайшие 2 месяца дат нет — проверь условия и правило повторения.</div>'}
  ${skipped.length ? `<span class="hint">Пропущено: ${skipped.map(d => esc(fmtDay(d))).join(', ')} <button class="btn ghost small" data-y="unskip">Вернуть</button></span>` : ''}
  <span class="hint">Нажми на дату — можно перенести только её или пропустить.</span>
  <div class="actions"><button class="btn ghost danger" data-y="del">Удалить дело</button><button class="btn ghost" data-y="close">Закрыть</button><button class="btn" data-y="edit">Изменить правило</button></div>`, 'Все даты');
  sh.addEventListener('click', e => {
    const b = e.target.closest('[data-y]'); if (!b) return;
    if (b.dataset.y === 'close') closeSheet();
    if (b.dataset.y === 'del') { if (b.dataset.sure) { deleteTask(t.id); closeSheet(); toast('Дело удалено'); } else { b.dataset.sure = 1; b.textContent = 'Точно удалить?'; } }
    if (b.dataset.y === 'edit') { closeSheet(); openEditor(t.id); }
    if (b.dataset.y === 'open') { closeSheet(); itemSheet(t.id, b.dataset.orig, b.dataset.ds); }
    if (b.dataset.y === 'unskip') { const sk = { ...(t.skip || {}) }; skipped.forEach(d => delete sk[d]); updateTask(t.id, { skip: sk }); closeSheet(); seriesSheet(t.id); }
  });
}
on('series', d => seriesSheet(d.id));

/** Все дни с признаком на 2 месяца: дача, отпуск, каникулы… Ручные признаки можно снять или поставить на любой день. */
export function flagDaysSheet(id) {
  const f = flagType(id); if (!f) return;
  const t0 = today(), days = [];
  for (let i = 0; i < 62; i++) { const d = addDays(t0, i); if (flagsOf(d).has(id)) days.push(d); }
  const editable = !f.auto || id === 'dacha';
  const why = { dacha: 'Общий выходной с мужем ставится автоматически. Снять или добавить день — кнопкой.', dacha_eve: 'Ставится сам: я работаю, муж выходной, а завтра дача — после работы выезд. Вечером фитнес и уборка не ставятся.', common_off: 'Мой выходной совпадает с выходным мужа.', cycle: 'По отметкам начала цикла в «Признаках дня».' }[id] || (f.auto ? '' : 'Отмеченные тобой дни и периоды.');
  let mo = '';
  const rows = days.map(d => { const m = d.slice(0, 7); const head = m !== mo ? (mo = m, `<div class="mo">${MON1[+m.slice(5) - 1]} ${m.slice(0, 4)}</div>`) : '';
    return head + `<div class="it"><div class="tm">${WDS[D(d).getDay()]}</div><div class="grow" data-z="day" data-v="${d}" style="cursor:pointer"><div class="t">${esc(dayLabel(d))}</div><div class="m">${id === 'dacha' ? (dachaIsAuto(d) ? 'общий выходной' : 'отмечено вручную') : ''}</div></div>${editable ? `<button class="btn ghost small" data-z="off" data-v="${d}">Снять</button>` : '<span></span>'}</div>`; }).join('');
  const sh = openSheet(`<h3><span class="dot" style="--c:${f.color}"></span> ${esc(f.name)}</h3><span class="hint">${esc(why)}</span>
  ${days.length ? `<div class="list">${rows}</div>` : '<div class="empty">В ближайшие 2 месяца таких дней нет.</div>'}
  ${editable ? `<div class="row"><input type="date" id="fd-add" class="inp" style="max-width:190px" min="${t0}"><button class="btn" data-z="add">Добавить день</button></div>` : ''}
  <div class="actions"><button class="btn ghost" data-z="close">Закрыть</button><span></span></div>`, f.name);
  sh.addEventListener('click', e => {
    const b = e.target.closest('[data-z]'); if (!b) return;
    const z = b.dataset.z;
    if (z === 'close') closeSheet();
    if (z === 'day') { closeSheet(); cal.view = 'day'; cal.day = b.dataset.v; window.app.go('calendar'); }
    if (z === 'off') { markDay(id, b.dataset.v); flagDaysSheet(id); }
    if (z === 'add') { const v = document.getElementById('fd-add').value; if (!v) return; if (!flagsOf(v).has(id)) markDay(id, v); flagDaysSheet(id); }
  });
}
on('flagDays', d => flagDaysSheet(d.id));

on('fav', d => { const t = getTask(d.id); if (!t) return; updateTask(t.id, { fav: !t.fav }); toast(t.fav ? 'Закреплено в избранном' : 'Убрано из избранного'); });

/** Блок «План записей на 3 месяца» для карточки и листа записи. */
export function planHtml(t) {
  if (!/маникюр|педикюр|брови|стрижк/i.test(t.title)) {
    const o = bookingOptions(t, 3);
    return o.length ? `<div class="chips sm">${o.map(x => slotChip(x, '', true)).join('')}</div>` : '<span class="hint">Подходящих окон пока нет.</span>';
  }
  const pl = planFor(t);
  if (!pl.length) return '<span class="hint">На 3 месяца вперёд подходящих окон по правилам не нашлось.</span>';
  return `<span class="hint">План на 3 месяца от последней записи. Нажми дату — проверишь и подтвердишь. ${/маникюр|педикюр/i.test(t.title) ? '🤝 — в этот день можно сделать и маникюр, и педикюр.' : ''}</span>
  <div class="chips sm">${pl.map(w => slotChip(w)).join('')}</div>
  <div><button class="btn small" data-act="bookPlanAll" data-id="${t.id}">Записать весь план (${pl.length})</button></div>${comboHtml(t)}`;
}

function comboHtml(t) {
  if (!/маникюр|педикюр/i.test(t.title)) return '';
  const c = comboDays(t);
  return c.length ? `<span class="hint">🤝 Дни, когда можно сделать маникюр и педикюр за один визит (4 ч):</span><div class="chips sm">${c.map(w => slotChip(w, '', true)).join('')}</div>` : '<span class="hint">🤝 Дней, когда можно сделать обе процедуры за один визит, в ближайшие 3 месяца нет.</span>';
}

/** Блок «Можно выбрать»: день подходит для дела «N раз в неделю», но лимит набран — можно поменять день. */
function altHtml(ds) {
  const a = altOn(ds); if (!a.length) return '';
  return `<section><h2>Можно выбрать</h2><div class="list">${a.map(x => `<div class="it alt"><div class="tm">${x.time}</div><div class="bd" style="--c:${cat(x.task.cat).color}" data-act="altPick" data-id="${x.task.id}" data-ds="${ds}" data-time="${x.time}"><div class="t">${esc(x.task.title)} — этот день тоже подходит</div><div class="m">На этой неделе уже ${x.picked.length || 'набрано'}: ${x.picked.map(p => esc((p.task && p.task !== x.task ? p.task.title + ' ' : '') + fmtDay(p.ds))).join(', ')}. Нажми, чтобы поставить сюда вместо одного из них.</div></div><span></span></div>`).join('')}</div></section>`;
}
on('altPick', d => {
  const t = getTask(d.id); if (!t) return;
  const a = altOn(d.ds).find(x => x.task === t); if (!a) return;
  const sh = openSheet(`<h3>${esc(t.title)}: ${esc(fmtDay(d.ds))}, ${d.time}</h3><span class="hint">Лимит — ${t.rule.perWeek} в неделю. Выбери, какой день заменить — он переедет сюда и закрепится.</span>
    <div class="chips">${a.picked.filter(p => !p.task || p.task === t).map(p => `<button class="chip" data-z="${p.ds}">вместо ${esc(fmtDay(p.ds))}${p.time ? ', ' + p.time : ''}</button>`).join('')}</div>
    ${a.picked.some(p => p.task && p.task !== t) ? `<span class="hint">Ещё на этой неделе: ${a.picked.filter(p => p.task && p.task !== t).map(p => esc(p.task.title + ' ' + fmtDay(p.ds))).join(', ')} — считается в общий спорт.</span>` : ''}
    <div class="actions"><button class="btn ghost" data-z="close">Закрыть</button></div>`, 'Выбор дня');
  sh.addEventListener('click', e => {
    const b = e.target.closest('[data-z]'); if (!b) return;
    if (b.dataset.z === 'close') return closeSheet();
    moveItem(t, b.dataset.z, d.ds, d.time); closeSheet(); toast(`${t.title}: перенесено на ${fmtDay(d.ds)}, ${d.time}`);
  });
});

/** На дачу, в отпуск, на больничный — ссылка на планировщик этого типа дня. */
const PLAN_CTX = [['dacha', '🏡', 'Дела на дачу'], ['vac_me', '🏖', 'Дела на отпуск'], ['vac_h', '🧳', 'Дела на отпуск мужа'], ['sick', '🤒', 'Дела на больничный']];
function planLinks(ds, inline = false) {
  const f = flagsOf(ds), out = PLAN_CTX.filter(([id]) => f.has(id));
  if (flagsOf(ds).has('my_work')) out.push(['work', '💼', 'Рабочие дела и встречи']);
  if (inline) return out.map(([id, ic, n]) => `<button class="chip" data-act="openPlan" data-v="${id}">${ic} ${n} ›</button>`).join('');
  return out.length ? `<div class="chips sm">${out.map(([id, ic, n]) => { const k = state.tasks.filter(t => !t.archived && !t.done && t.kind === 'once' && (id === 'work' ? (t.ctx === 'work' || (!t.ctx && t.cat === 'work')) : t.ctx === id)).length; return `<button class="chip" data-act="openPlan" data-v="${id}">${ic} ${n}${k ? ' · ' + k : ''} ›</button>`; }).join('')}</div>` : '';
}
on('openPlan', d => import('./work-view.js?v=2.6.3').then(w => { w.setCtx(d.v); window.app.go('work'); }));

/** Почему завтра нет среди вариантов переноса — чтобы не гадать. */
function tomorrowWhy(t, ds, slots) {
  const tm = addDays(today(), 1);
  if (ds === tm || slots.some(x => x.ds === tm)) return '';
  const f = flagsOf(tm), why = apptWhyNot(t, tm) || whyNot(t, tm);
  const named = f.has('dacha') ? 'завтра дача' : f.has('cycle') && JSON.stringify(t.cond || '').includes('cycle') ? 'завтра цикл' : f.has('donor') ? 'завтра сдача крови' : '';
  return `<span class="hint">ℹ️ Завтра не предлагаю: ${esc(named || why || 'нет свободного времени рядом с привычным')}. Можно поставить вручную ниже.</span>`;
}
