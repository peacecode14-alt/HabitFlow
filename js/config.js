export const APP_CONFIG = {
  name: "HabitFlow",
  version: "1.2.0",
  storageKey: "habitflow_data",
  syncKey: "habitflow_sync",
  // Bump this whenever the stored data shape changes, and add a matching
  // step to js/migrations.js.
  schemaVersion: 3,
  defaultLanguage: "en",
  defaultTheme: "dark",
  // Brand cyan; also the default colour for new habits.
  defaultHabitColor: "#22D3EE",
  // Built-in categories. Users can also create their own.
  categories: ["Health", "Learning", "Mindfulness", "Productivity", "Personal"],
};

// Habit colours are written into style attributes, so only plain #RRGGBB is accepted.
export const isHexColor = (value) =>
  typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
