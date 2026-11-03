// Движок условий. Условие — дерево из групп И/ИЛИ над признаками дня; у каждого признака есть «НЕ».
//
// cond = { op: 'and' | 'or', items: [ {flag:'h_works'}, {flag:'cycle', not:true}, {op:'or', items:[...]} ] }
// Пустое условие (null или нет items) — задача ставится всегда.
import { flagsOf, flagType } from './core-flags.js?v=2.6.3';

export function evalCond(cond, ds) {
  if (!cond || !cond.items || !cond.items.length) return true;
  const f = flagsOf(ds);
  const test = it => it.items ? evalCond(it, ds) : (f.has(it.flag) !== !!it.not);
  return cond.op === 'or' ? cond.items.some(test) : cond.items.every(test);
}

/** Текст условия: «(мой рабочий день и муж: выходной) или …». */
export function describeCond(cond) {
  if (!cond || !cond.items || !cond.items.length) return '';
  const part = it => it.items ? '(' + describeCond(it) + ')' : (it.not ? 'не ' : '') + ((flagType(it.flag)?.name || it.flag).toLowerCase());
  return cond.items.map(part).join(cond.op === 'or' ? ' или ' : ' и ');
}
