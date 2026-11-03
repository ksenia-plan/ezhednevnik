// Реестр вкладок-модулей. Новая вкладка = новый файл в tabs/ + одна строка здесь.
// Модуль: { id, name, icon (svg path), render(): html, bind?(root) }.
// Все модули пользуются общим движком задач и календаря (state.tasks, itemsOn и т.д.).
import * as english from './tabs-english.js?v=2.6.3';
import * as exercise from './tabs-exercise.js?v=2.6.3';

export const TAB_MODULES = [english, exercise];
export const tabModule = id => TAB_MODULES.find(m => m.id === id);
