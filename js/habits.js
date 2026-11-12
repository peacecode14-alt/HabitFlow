import { loadData, saveData } from "./storage.js";
let habits = loadData().habits;
const persist = () => saveData({ ...loadData(), habits });
export const getAllHabits = () => habits.map(h => ({ ...h, frequency: [...(h.frequency || [])], completions: [...(h.completions || [])] }));
export function addHabit(data) {
  const name = String(data.name || "").trim();
  if (!name || !Array.isArray(data.frequency) || !data.frequency.length) return false;
  const habit = { id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, name, category: data.category || "Personal", icon: data.icon || "✦", color: data.color || "#42D9F5", frequency: [...data.frequency], createdAt: new Date().toISOString(), completions: [] };
  habits.push(habit);
  if (!persist()) { habits.pop(); return false; }
  return true;
}
export function updateHabit(id, data) {
  const i = habits.findIndex(h => h.id === id);
  if (i < 0) return false;
  const old = habits[i];
  habits[i] = { ...old, ...data, name: String(data.name ?? old.name).trim(), frequency: [...(data.frequency ?? old.frequency)] };
  if (!persist()) { habits[i] = old; return false; }
  return true;
}
export function deleteHabit(id) {
  const old = habits; habits = habits.filter(h => h.id !== id);
  if (!persist()) { habits = old; return false; }
  return true;
}
export function toggleCompletion(id, date = new Date().toISOString().slice(0,10)) {
  const habit = habits.find(h => h.id === id);
  if (!habit) return false;
  const set = new Set(habit.completions || []);
  set.has(date) ? set.delete(date) : set.add(date);
  const old = habit.completions;
  habit.completions = [...set].sort();
  if (!persist()) { habit.completions = old; return false; }
  return true;
}
export function replaceHabits(next) {
  if (!Array.isArray(next)) return false;
  const old = habits; habits = next;
  if (!persist()) { habits = old; return false; }
  return true;
}
