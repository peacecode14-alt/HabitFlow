import { APP_CONFIG } from "./config.js";
const KEY = APP_CONFIG.storageKey;
export function loadData() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { habits: [], settings: { language: APP_CONFIG.defaultLanguage, theme: APP_CONFIG.defaultTheme } };
    const parsed = JSON.parse(raw);
    return {
      habits: Array.isArray(parsed.habits) ? parsed.habits : [],
      settings: { language: parsed.settings?.language || APP_CONFIG.defaultLanguage, theme: parsed.settings?.theme || APP_CONFIG.defaultTheme }
    };
  } catch (error) {
    console.error("Could not read HabitFlow data:", error);
    return { habits: [], settings: { language: APP_CONFIG.defaultLanguage, theme: APP_CONFIG.defaultTheme } };
  }
}
export function saveData(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); return true; }
  catch (error) { console.error("Could not save HabitFlow data:", error); return false; }
}
export function clearData() {
  try { localStorage.removeItem(KEY); return true; }
  catch (error) { console.error("Could not clear HabitFlow data:", error); return false; }
}
