import { migrate } from "../migrations.js";

export class BackupError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/**
 * Read a HabitFlow backup file (any schema version, including files exported
 * before versioning existed) and return habits ready to be restored.
 * Restored habits get a fresh `updatedAt` so they win over older deletion
 * records when cloud sync is on.
 */
export function parseBackup(text, restoredAt = new Date().toISOString()) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError("INVALID_JSON");
  }
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    !Array.isArray(raw.habits)
  )
    throw new BackupError("INVALID_FILE");

  let result;
  try {
    result = migrate(raw);
  } catch {
    throw new BackupError("INVALID_FILE");
  }
  if (result.newer) throw new BackupError("NEWER");

  const habits = result.data.habits.map((h) => ({
    ...h,
    updatedAt: restoredAt,
  }));
  const ids = new Set(habits.map((h) => h.id));
  const deleted = Object.fromEntries(
    Object.entries(result.data.deleted || {}).filter(([id]) => !ids.has(id)),
  );
  return { habits, deleted, count: habits.length };
}
