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
  // Built-in categories. Users can also create their own.
  categories: ["Health", "Learning", "Mindfulness", "Productivity", "Personal"],
};
