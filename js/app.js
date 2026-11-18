import { APP_CONFIG } from "./config.js";
import { translations } from "./translations.js";
import { loadData, saveData, clearData, snapshotBeforeImport } from "./storage.js";
import { getAllHabits, addHabit, updateHabit, deleteHabit, restoreHabit, toggleCompletion, adjustValue, setNote, archiveHabit, replaceHabits, applyMergedState } from "./habits.js";
import { dateToKey, getTodayKey } from "./services/date.js";
import { isScheduled, currentStreak, bestStreak, completionRate } from "./services/stats.js";
import { isDone, valueOn, targetOf, noteOn } from "./services/log.js";
import { loadSyncConfig, saveSyncConfig, clearSyncConfig, syncNow, hasUnsyncedChanges, SyncError } from "./services/sync.js";
import { dueReminders, notificationPermission, showSystemNotification } from "./services/reminders.js";
import { parseBackup } from "./services/backup.js";
import { TEMPLATES } from "./templates.js";

/* ---------- state ---------- */
let data = loadData();
let language = data.settings.language;
let theme = data.settings.theme;
let currentView = "dashboard";
let currentFilter = "all";      // all | active | completed | archived
let currentCategory = "all";
let searchQuery = "";
let sortBy = "newest";
let calendarDate = new Date();
let editingId = null;
let dayModalDate = null;
let lastFocus = null;
let syncState = "idle";         // idle | syncing | offline | error
let syncError = null;
let syncTimer = null;
let stopRealtimeListener = null;
let realtimeListenerUid = null;
let realtimeSyncPending = false;
const firedReminders = new Set(readFired());

/* ---------- helpers ---------- */
const $ = (selector, root = document) => root.querySelector(selector);

/* ---------- signed-in profile ---------- */
function renderProfile(name = "", email = "") {
  const nameElement = $("#profileDisplayName");
  const avatarElement = $("#profileAvatar");
  const subtitleElement = $("#profileSubtitle");
  if (!nameElement || !avatarElement || !subtitleElement) return;

  const cleanName = String(name || "").trim();
  const emailName = String(email || "").split("@")[0].trim();
  const displayName = cleanName || emailName || t().yourSpace;
  nameElement.textContent = displayName;
  avatarElement.textContent = cleanName || emailName
    ? Array.from(displayName)[0].toLocaleUpperCase(language === "ar" ? "ar-EG" : "en-US")
    : "M";
  subtitleElement.textContent = email || t().personalJourney;
}

let currentUser = null;
function stopRealtimeSync() {
  if (stopRealtimeListener) {
    stopRealtimeListener();
  }

  stopRealtimeListener = null;
  realtimeListenerUid = null;
}

function loadSignedInProfile(user) {
  const nextUser = user && user.emailVerified ? user : null;

  if (!nextUser || currentUser?.uid !== nextUser.uid) {
    stopRealtimeSync();
  }

  currentUser = nextUser;
  if (!currentUser) renderProfile();
  else renderProfile(currentUser.displayName || "", currentUser.email || "");
  renderSyncStatus();
  if (currentUser && loadSyncConfig().enabled) runSync();
}

// Firebase is loaded lazily so the habit tracker keeps working if the CDN is unreachable (e.g. offline).
async function watchAccount() {
  try {
    const FIREBASE_AUTH_URL = "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
    const [{ auth }, { onAuthStateChanged }] = await Promise.all([import("./firebase-client.js"), import(FIREBASE_AUTH_URL)]);
    onAuthStateChanged(auth, user => loadSignedInProfile(user || null));
  } catch (error) {
    console.warn("HabitFlow: account features unavailable right now.", error);
  }
}

const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const t = () => translations[language];
const today = getTodayKey;
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const BUILTIN_CATEGORIES = { Health: "health", Learning: "learning", Mindfulness: "mindfulness", Productivity: "productivity", Personal: "personal" };
const categoryName = value => (BUILTIN_CATEGORIES[value] ? t()[BUILTIN_CATEGORIES[value]] : value);
const locale = () => (language === "ar" ? "ar-EG" : "en-US");
const persistSettings = () => saveData({ habits: getAllHabits(), settings: { language, theme } });

function allCategories(habits = getAllHabits()) {
  const custom = [...new Set(habits.map(h => h.category).filter(c => c && !BUILTIN_CATEGORIES[c]))].sort((a, b) => a.localeCompare(b));
  return [...APP_CONFIG.categories, ...custom];
}
function readFired() {
  try { return JSON.parse(sessionStorage.getItem("habitflow_fired") || "[]"); } catch { return []; }
}
function writeFired() {
  try { sessionStorage.setItem("habitflow_fired", JSON.stringify([...firedReminders].slice(-200))); } catch { /* ignore */ }
}

/* ---------- preferences & translations ---------- */
function applyPreferences() {
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  document.documentElement.dataset.theme = theme;
  $("#languageToggle").textContent = language === "en" ? "العربية" : "English";
  $("#themeToggle").textContent = theme === "dark" ? "☼" : "☾";
  persistSettings();
  $$("[data-theme]").forEach(b => b.classList.toggle("selected", b.dataset.theme === theme));
  $$("[data-lang]").forEach(b => b.classList.toggle("selected", b.dataset.lang === language));
}
function applyTranslations() {
  $$("[data-i18n]").forEach(el => {
    const value = t()[el.dataset.i18n];
    if (typeof value === "string") el.textContent = value;
  });
  $$("[data-i18n-placeholder]").forEach(el => {
    const value = t()[el.dataset.i18nPlaceholder];
    if (typeof value === "string") el.placeholder = value;
  });
  $("#categoryFilter").setAttribute("aria-label", t().categoryFilterLabel);
  $("#habitSort").setAttribute("aria-label", t().sortLabel);
  $("#habitSearch").setAttribute("aria-label", t().searchHabits);
  $("#syncPassphrase").setAttribute("aria-label", t().syncPassphrasePlaceholder);
  $$(".icon-button[aria-label='Close'], #closeModal, #closeDayModal").forEach(b => b.setAttribute("aria-label", t().close));
  $("#topDate").textContent = new Intl.DateTimeFormat(locale(), { weekday: "short", month: "short", day: "numeric" }).format(new Date());
  $("#year").textContent = new Date().getFullYear();
  $("#pageTitle").textContent = t()[currentView === "habits" ? "myHabits" : currentView] || t().dashboard;
  renderProfile(currentUser?.displayName || "", currentUser?.email || "");
  renderSyncStatus();
  renderAll();
}

/* ---------- toast ---------- */
function showToast(message, action) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("has-action", Boolean(action));
  if (action) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "toast-action"; button.textContent = action.label;
    button.addEventListener("click", () => { action.onClick(); toast.classList.remove("show"); });
    toast.append(button);
  }
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), action ? 6500 : 2600);
}

/* ---------- navigation ---------- */
function setView(view) {
  currentView = view;
  $$(".view").forEach(el => el.classList.toggle("active", el.id === `${view}View`));
  $$(".nav-link[data-view]").forEach(el => {
    const active = el.dataset.view === view;
    el.classList.toggle("active", active);
    if (active) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
  });
  $("#pageTitle").textContent = t()[view === "habits" ? "myHabits" : view] || t().dashboard;
  closeSidebar(); renderAll();
}
function closeSidebar() { $("#sidebar").classList.remove("open"); $("#mobileOverlay").classList.remove("show"); }

/* ---------- statistics ---------- */
function statsFor(date = today(), habits = getAllHabits()) {
  const due = habits.filter(h => isScheduled(h, date));
  const completed = due.filter(h => isDone(h, date)).length;
  return { total: due.length, completed, remaining: due.length - completed, percent: due.length ? Math.round(completed / due.length * 100) : 0 };
}
function statCard(label, value, foot, icon) {
  return `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon" aria-hidden="true">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></article>`;
}
function renderStats(habits) {
  const active = habits.filter(h => !h.archivedAt), key = today(), s = statsFor(key, habits);
  const current = Math.max(0, ...active.map(h => currentStreak(h, key)));
  const best = Math.max(0, ...active.map(h => bestStreak(h, key)));
  const cards = [
    statCard(t().todayProgress, `${s.percent}%`, `${s.completed} ${t().completed.toLowerCase()} · ${s.remaining} ${t().remaining.toLowerCase()}`, "◷"),
    statCard(t().completed, s.completed, t().percentDone, "✓"),
    statCard(t().currentStreak, current, `${t().streakUnit} · ${t().bestStreak}: ${best}`, "↗"),
    statCard(t().totalHabits, active.length, t().habitsCount, "◈")
  ].join("");
  $("#statsGrid").innerHTML = cards;
  $("#statisticsSummary").innerHTML = cards;
}

/* ---------- habit rows ---------- */
function controlMarkup(h, date) {
  const id = escapeHTML(h.id), done = isDone(h, date), value = valueOn(h, date);
  if (h.type === "count") {
    return `<div class="counter" role="group" aria-label="${escapeHTML(h.name)}">
      <button type="button" class="counter-btn" data-action="dec" data-id="${id}" data-date="${date}" aria-label="${t().decrease}" ${value <= 0 ? "disabled" : ""}>−</button>
      <span class="counter-value ${done ? "done" : ""}" aria-live="polite">${value}/${targetOf(h)}</span>
      <button type="button" class="counter-btn" data-action="inc" data-id="${id}" data-date="${date}" aria-label="${t().increase}">＋</button>
    </div>`;
  }
  return `<button type="button" class="habit-check ${done ? "done" : ""}" data-action="toggle" data-id="${id}" data-date="${date}" aria-pressed="${done}" aria-label="${escapeHTML(h.name)}: ${done ? t().markUndone : t().markDone}">${done ? "✓" : ""}</button>`;
}
function habitMarkup(h, date = today(), { compact = false } = {}) {
  const id = escapeHTML(h.id), archived = Boolean(h.archivedAt), done = !archived && isDone(h, date);
  const streak = !archived && !compact ? currentStreak(h, today()) : 0;
  const reminder = h.reminderTime && !compact ? ` · ⏰ ${escapeHTML(h.reminderTime)}` : "";
  const actions = compact ? "" : archived
    ? `<button type="button" class="mini-action" data-action="restore" data-id="${id}" title="${t().restore}" aria-label="${t().restore}">↺</button><button type="button" class="mini-action" data-action="delete" data-id="${id}" title="${t().delete}" aria-label="${t().delete}">⌫</button>`
    : `<button type="button" class="mini-action" data-action="edit" data-id="${id}" title="${t().edit}" aria-label="${t().edit}">✎</button><button type="button" class="mini-action" data-action="archive" data-id="${id}" title="${t().archive}" aria-label="${t().archive}">▣</button><button type="button" class="mini-action" data-action="delete" data-id="${id}" title="${t().delete}" aria-label="${t().delete}">⌫</button>`;
  return `<article class="habit-item ${done ? "completed" : ""} ${archived ? "archived" : ""}" data-id="${id}">
    <span class="habit-color" style="background:${escapeHTML(h.color)}"></span><span class="habit-emoji" aria-hidden="true">${escapeHTML(h.icon)}</span>
    <div class="habit-info"><strong>${escapeHTML(h.name)}</strong><small><span class="category-dot" style="background:${escapeHTML(h.color)}"></span>${escapeHTML(categoryName(h.category))}${streak > 0 ? ` · 🔥 ${streak}` : ""}${reminder}</small></div>
    ${archived ? "" : controlMarkup(h, date)}
    <div class="habit-actions">${actions}</div>
  </article>`;
}
function emptyState(title, desc, { button = false, templates = false } = {}) {
  const chips = templates
    ? `<p class="templates-title">${t().templatesTitle}</p><div class="templates">${TEMPLATES.map(tp => `<button type="button" class="template-chip" data-action="template" data-key="${tp.key}"><span aria-hidden="true">${tp.icon}</span> ${escapeHTML(tp.name[language])}</button>`).join("")}</div>`
    : "";
  return `<div class="no-habits"><div class="empty-icon" aria-hidden="true">✧</div><h3>${title}</h3><p>${desc}</p>${button ? `<button type="button" class="primary-button" data-action="new">＋ ${t().createFirst}</button>` : ""}${chips}</div>`;
}

/* ---------- lists ---------- */
function renderTodayHabits(habits) {
  const list = habits.filter(h => isScheduled(h, today()));
  const hasAny = habits.some(h => !h.archivedAt);
  $("#todayHabits").innerHTML = list.length
    ? list.map(h => habitMarkup(h)).join("")
    : emptyState(t().noToday, t().noTodayDesc, { button: true, templates: !hasAny });
}
function sortHabits(list) {
  const cmp = (a, b) => a.localeCompare(b, language);
  const key = today();
  return [...list].sort((a, b) => {
    if (sortBy === "name") return cmp(a.name, b.name);
    if (sortBy === "category") return cmp(categoryName(a.category), categoryName(b.category)) || cmp(a.name, b.name);
    if (sortBy === "streak") return currentStreak(b, key) - currentStreak(a, key) || cmp(a.name, b.name);
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
}
function visibleHabits(habits) {
  const q = searchQuery.trim().toLowerCase();
  let list;
  if (currentFilter === "archived") list = habits.filter(h => h.archivedAt);
  else {
    list = habits.filter(h => !h.archivedAt);
    if (currentFilter === "active") list = list.filter(h => !isDone(h, today()));
    if (currentFilter === "completed") list = list.filter(h => isDone(h, today()));
  }
  if (currentCategory !== "all") list = list.filter(h => h.category === currentCategory);
  if (q) list = list.filter(h => h.name.toLowerCase().includes(q) || categoryName(h.category).toLowerCase().includes(q));
  return sortHabits(list);
}
function renderAllHabits(habits) {
  const list = visibleHabits(habits);
  const base = habits.filter(h => (currentFilter === "archived" ? h.archivedAt : !h.archivedAt));
  $("#habitCount").textContent = `${list.length} / ${base.length}`;
  let html;
  if (list.length) html = list.map(h => habitMarkup(h)).join("");
  else if (base.length) html = emptyState(t().noMatch, t().noMatchDesc);
  else if (currentFilter === "archived") html = emptyState(t().noArchived, t().noArchivedDesc);
  else html = emptyState(t().noHabits, t().noHabitsDesc, { button: true, templates: true });
  $("#allHabits").innerHTML = html;
}
function renderCategoryOptions(habits) {
  const cats = allCategories(habits);
  if (currentCategory !== "all" && !cats.includes(currentCategory)) currentCategory = "all";
  $("#categoryFilter").innerHTML = `<option value="all">${t().allCategories}</option>` + cats.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(categoryName(c))}</option>`).join("");
  $("#categoryFilter").value = currentCategory;
  const current = $("#habitCategory").value;
  $("#habitCategory").innerHTML = cats.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(categoryName(c))}</option>`).join("") + `<option value="__new__">${t().newCategory}</option>`;
  if (current) $("#habitCategory").value = current;
}

/* ---------- charts ---------- */
function weekDates() {
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return d; });
}
function chartMarkup(container, dates, habits) {
  container.innerHTML = dates.map(d => {
    const s = statsFor(dateToKey(d), habits);
    return `<div class="chart-day"><div class="bar-track" title="${s.completed}/${s.total}"><div class="bar-fill" style="height:${s.percent}%"></div></div><small>${t().days[d.getDay()]}</small></div>`;
  }).join("");
}
function renderCharts(habits) {
  chartMarkup($("#weeklyChart"), weekDates(), habits);
  chartMarkup($("#statsChart"), weekDates(), habits);
  const key = today(), active = habits.filter(h => !h.archivedAt);
  $("#habitPerformance").innerHTML = active.length ? active.map(h => {
    const rate = completionRate(h, key);
    return `<div class="performance-row"><strong>${escapeHTML(h.icon)} ${escapeHTML(h.name)}</strong><small>${rate.percent}% · ${t().streak} ${currentStreak(h, key)} · ${t().bestStreak} ${bestStreak(h, key)}</small><div class="performance-track"><div class="performance-fill" style="width:${rate.percent}%"></div></div></div>`;
  }).join("") : `<div class="empty-state">${t().noData}</div>`;
}

/* ---------- calendar & day editor ---------- */
function renderCalendar(habits) {
  const year = calendarDate.getFullYear(), month = calendarDate.getMonth(), todayKey = today();
  $("#calendarMonth").textContent = new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric" }).format(calendarDate);
  const first = new Date(year, month, 1).getDay(), count = new Date(year, month + 1, 0).getDate();
  let html = t().weekdays.map(d => `<div class="calendar-cell weekday">${d}</div>`).join("");
  for (let i = 0; i < first; i++) html += `<div class="calendar-cell" aria-hidden="true"></div>`;
  for (let day = 1; day <= count; day++) {
    const key = dateToKey(new Date(year, month, day));
    const due = habits.filter(h => isScheduled(h, key)), done = due.filter(h => isDone(h, key)).length;
    const cls = [key === todayKey ? "today" : "", done > 0 ? "has-progress" : "", due.length > 0 && done === due.length ? "perfect" : ""].filter(Boolean).join(" ");
    const label = `${new Intl.DateTimeFormat(locale(), { dateStyle: "full" }).format(new Date(year, month, day))}: ${done}/${due.length}`;
    html += `<button type="button" class="calendar-cell ${cls}" data-date="${key}" title="${done}/${due.length}" aria-label="${label}" ${key > todayKey ? "disabled" : ""}><span>${day}</span>${done ? '<i class="day-dot"></i>' : ""}</button>`;
  }
  $("#calendarGrid").innerHTML = html;
}
function refreshDayModal() {
  if (!dayModalDate) return;
  if (document.activeElement?.classList.contains("day-note")) return; // do not disturb typing
  const [y, m, d] = dayModalDate.split("-").map(Number);
  $("#dayModalTitle").textContent = new Intl.DateTimeFormat(locale(), { dateStyle: "full" }).format(new Date(y, m - 1, d));
  const list = getAllHabits().filter(h => isScheduled(h, dayModalDate, { ignoreStart: true }));
  $("#dayHabits").innerHTML = list.length
    ? list.map(h => `<div class="day-row">${habitMarkup(h, dayModalDate, { compact: true })}<input class="day-note" data-action="note" data-id="${escapeHTML(h.id)}" data-date="${dayModalDate}" maxlength="200" value="${escapeHTML(noteOn(h, dayModalDate))}" placeholder="${escapeHTML(t().notePlaceholder)}" aria-label="${escapeHTML(h.name)}: ${escapeHTML(t().notePlaceholder)}"></div>`).join("")
    : `<div class="empty-state">${t().noHabitsThatDay}</div>`;
}
function openDayModal(key) { dayModalDate = key; refreshDayModal(); openModalEl($("#dayModal"), "#closeDayModal"); }

/* ---------- render ---------- */
function renderAll() {
  const habits = getAllHabits();
  renderCategoryOptions(habits);
  renderStats(habits); renderTodayHabits(habits); renderAllHabits(habits); renderCharts(habits); renderCalendar(habits);
  renderSyncStatus(); renderReminderStatus(); refreshDayModal();
}
function afterChange() { renderAll(); scheduleSync(); }

/* ---------- modals ---------- */
function openModalEl(el, focusSelector) {
  lastFocus = document.activeElement;
  el.classList.add("open"); el.setAttribute("aria-hidden", "false");
  $(focusSelector, el)?.focus();
}
function closeModalEl(el) {
  el.classList.remove("open"); el.setAttribute("aria-hidden", "true");
  if (el.id === "habitModal") editingId = null;
  if (el.id === "dayModal") dayModalDate = null;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}
function trapFocus(event) {
  const modal = $(".modal-backdrop.open");
  if (!modal || event.key !== "Tab") return;
  const focusable = $$("button:not([disabled]), input:not([hidden]):not([disabled]), select:not([disabled])", modal).filter(el => el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function openModal(id = null) {
  editingId = id;
  const form = $("#habitForm"); form.reset();
  renderCategoryOptions(getAllHabits());
  const habit = id ? getAllHabits().find(h => h.id === id) : null;
  $("#modalTitle").textContent = habit ? t().editHabit : t().newHabit;
  $("#habitName").value = habit?.name || "";
  $("#habitCategory").value = habit?.category || "Health";
  $("#newCategory").hidden = true; $("#newCategory").value = "";
  $("#habitIcon").value = habit?.icon || "✦";
  $("#habitType").value = habit?.type === "count" ? "count" : "check";
  $("#habitTarget").value = habit ? targetOf(habit) : 1;
  $("#targetWrap").hidden = $("#habitType").value !== "count";
  $("#habitReminder").value = habit?.reminderTime || "";
  const swatches = $$('input[name="color"]');
  const wanted = String(habit?.color || APP_CONFIG.defaultHabitColor).toUpperCase();
  // Habits saved with the previous brand cyan map onto the new one.
  const target = wanted === "#42D9F5" ? APP_CONFIG.defaultHabitColor.toUpperCase() : wanted;
  swatches.forEach(input => (input.checked = input.value.toUpperCase() === target));
  if (!swatches.some(input => input.checked) && swatches[0]) swatches[0].checked = true;
  const selected = habit?.frequency || [0, 1, 2, 3, 4, 5, 6];
  $$(".day-option").forEach(b => b.classList.toggle("selected", selected.includes(Number(b.dataset.day))));
  openModalEl($("#habitModal"), "#habitName");
}
function initDays() {
  $("#daysPicker").innerHTML = t().days.map((day, i) => `<button type="button" class="day-option selected" data-day="${i}" aria-pressed="true">${day}</button>`).join("");
}
function submitHabit(event) {
  event.preventDefault();
  const name = $("#habitName").value.trim();
  const frequency = $$(".day-option.selected").map(b => Number(b.dataset.day));
  if (!name) { showToast(t().nameRequired); return; }
  if (!frequency.length) { showToast(t().chooseDay); return; }
  let category = $("#habitCategory").value;
  if (category === "__new__") {
    const typed = $("#newCategory").value.trim();
    if (!typed) { showToast(t().categoryRequired); $("#newCategory").focus(); return; }
    category = allCategories().find(c => c.toLowerCase() === typed.toLowerCase()) || typed;
  }
  const payload = {
    name, category, frequency,
    icon: $("#habitIcon").value, color: $('input[name="color"]:checked').value,
    type: $("#habitType").value, target: $("#habitTarget").value, reminderTime: $("#habitReminder").value
  };
  const wasEditing = Boolean(editingId);
  const ok = wasEditing ? updateHabit(editingId, payload) : addHabit(payload);
  if (ok) { showToast(wasEditing ? t().habitUpdated : t().habitAdded); closeModalEl($("#habitModal")); afterChange(); }
}

/* ---------- habit actions ---------- */
function addFromTemplate(key) {
  const tpl = TEMPLATES.find(x => x.key === key);
  if (!tpl) return;
  if (addHabit({ ...tpl, name: tpl.name[language] })) { showToast(t().habitAdded); afterChange(); }
}
function handleHabitAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button || button.tagName === "INPUT") return;
  const { action, id } = button.dataset;
  if (action === "new") { openModal(); return; }
  if (action === "template") { addFromTemplate(button.dataset.key); return; }
  const habit = getAllHabits().find(h => h.id === id);
  if (!habit) return;
  const date = button.dataset.date || today();
  if (date > today()) return;

  if (action === "toggle") {
    const wasDone = isDone(habit, date);
    if (toggleCompletion(id, date)) { showToast(wasDone ? t().habitUncompleted : t().habitCompleted); afterChange(); }
  } else if (action === "inc" || action === "dec") {
    const wasDone = isDone(habit, date);
    if (adjustValue(id, action === "inc" ? 1 : -1, date)) {
      const nowDone = isDone(getAllHabits().find(h => h.id === id), date);
      if (nowDone && !wasDone) showToast(t().habitCompleted);
      afterChange();
    }
  } else if (action === "edit") openModal(id);
  else if (action === "archive") { if (archiveHabit(id, true)) { showToast(t().habitArchived); afterChange(); } }
  else if (action === "restore") { if (archiveHabit(id, false)) { showToast(t().habitRestored); afterChange(); } }
  else if (action === "delete") {
    if (deleteHabit(id)) {
      afterChange();
      showToast(t().habitDeleted, { label: t().undo, onClick: () => { if (restoreHabit(habit)) { showToast(t().habitRestored); afterChange(); } } });
    }
  }
}

/* ---------- backup ---------- */
function exportBackup() {
  const blob = new Blob([JSON.stringify({ app: APP_CONFIG.name, version: APP_CONFIG.version, exportedAt: new Date().toISOString(), ...loadData() }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = t().exportFilename; a.click(); URL.revokeObjectURL(url);
  showToast(t().dataExported);
}
async function importBackup(file) {
  if (!file) return;
  try {
    const parsed = parseBackup(await file.text());
    if (!confirm(t().confirmImport.replace("{n}", parsed.count))) return;
    snapshotBeforeImport();
    if (applyMergedState({ habits: parsed.habits, deleted: parsed.deleted })) { showToast(t().importDone); afterChange(); }
    else showToast(t().importFailed);
  } catch (error) {
    const messages = { INVALID_JSON: t().importInvalidJson, INVALID_FILE: t().importInvalidFile, NEWER: t().importNewer };
    showToast(messages[error.code] || t().importFailed);
  } finally { $("#importFile").value = ""; }
}
function resetAppData() {
  if (!confirm(t().confirmReset)) return;
  stopRealtimeSync();
  clearTimeout(syncTimer); clearData(); clearSyncConfig(); localStorage.removeItem("habitflow_cloud_owner"); loadSyncInputs();
  syncState = "idle"; syncError = null; replaceHabits([]);
  language = APP_CONFIG.defaultLanguage; theme = APP_CONFIG.defaultTheme;
  persistSettings(); applyPreferences(); applyTranslations(); initDays(); showToast(t().dataReset);
}

/* ---------- reminders ---------- */
function checkReminders() {
  const due = dueReminders({ habits: getAllHabits(), now: new Date(), fired: firedReminders });
  for (const { habit, id } of due) {
    firedReminders.add(id);
    showToast(`⏰ ${habit.icon} ${habit.name}`);
    showSystemNotification(t().reminderTitle, `${habit.icon} ${habit.name}`, id);
  }
  if (due.length) writeFired();
}
function renderReminderStatus() {
  const el = $("#reminderStatus"), permission = notificationPermission();
  const text = { unsupported: t().notifUnsupported, default: t().notifDefault, granted: t().notifGranted, denied: t().notifDenied }[permission];
  el.textContent = text; el.className = `sync-status ${permission === "granted" ? "ok" : permission === "denied" ? "warn" : ""}`.trim();
  $("#enableNotifications").disabled = permission !== "default";
}
async function enableNotifications() {
  if (notificationPermission() !== "default") return;
  try { await Notification.requestPermission(); } catch (error) { console.error(error); }
  renderReminderStatus();
}

/* ---------- cloud sync ---------- */
function syncErrorText(error) {
  const map = {
    AUTH: t().syncAuthError,
    REMOTE_NEWER: t().syncRemoteNewer,
    ENC_REQUIRED: t().syncEncRequired,
    ENC_WRONG: t().syncEncWrong,
    ACCOUNT_MISMATCH: t().syncAccountMismatch,
    BAD_REMOTE: t().syncBadRemote
  };
  if (map[error?.code]) return map[error.code];
  if (error?.code === "permission-denied" || error?.code === "unauthenticated") return t().syncAuthError;
  if (error?.code === "unavailable" || error?.code === "deadline-exceeded") return t().syncOffline;
  return error?.message || t().syncFailed;
}
function renderSyncStatus() {
  const cfg = loadSyncConfig(), el = $("#syncStatus");
  const enabled = cfg.enabled;
  let text, tone = "";
  if (!currentUser) text = t().syncSignInRequired;
  else if (!enabled) text = t().syncNotConnected;
  else if (syncState === "syncing") text = t().syncSyncing;
  else if (syncState === "offline") { text = t().syncOffline; tone = "warn"; }
  else if (syncState === "error") { text = `${t().syncFailedStatus}: ${syncErrorText(syncError)}`; tone = "error"; }
  else {
    const last = loadData().meta.lastSyncedAt;
    const when = last ? new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(last)) : "";
    text = hasUnsyncedChanges() || !last ? t().syncPending : `${t().syncLastSynced}: ${when}`;
    tone = "ok";
  }
  el.textContent = text; el.className = `sync-status ${tone}`.trim();
  $("#syncSave").disabled = !currentUser;
  $("#syncNow").disabled = !currentUser || !enabled || syncState === "syncing";
  $("#syncDisconnect").disabled = !enabled;
}
async function startRealtimeSync(uid) {
  if (realtimeListenerUid === uid && stopRealtimeListener) return;

  stopRealtimeSync();

  try {
    const { createFirestoreAdapter } =
      await import("./services/firestore-sync.js");

    if (
      !currentUser ||
      currentUser.uid !== uid ||
      !loadSyncConfig().enabled
    ) return;

    const adapter = createFirestoreAdapter(uid);

    stopRealtimeListener = adapter.listen(
      () => {
        if (!currentUser || currentUser.uid !== uid) return;

        if (syncState === "syncing") {
          realtimeSyncPending = true;
          return;
        }

        runSync();
      },
      error => {
        console.warn("HabitFlow realtime listener error:", error);
      }
    );

    realtimeListenerUid = uid;
  } catch (error) {
    console.error("Could not start realtime sync:", error);
  }
}

async function runSync(manual = false) {
  const cfg = loadSyncConfig();
  if (!cfg.enabled || !currentUser) {
    renderSyncStatus();
    return;
  }

  if (syncState === "syncing") {
    realtimeSyncPending = true;
    return;
  }
  if (!navigator.onLine) { syncState = "offline"; renderSyncStatus(); return; }

  const ownerKey = "habitflow_cloud_owner";
  const existingOwner = localStorage.getItem(ownerKey);
  if (existingOwner && existingOwner !== currentUser.uid) {
    syncState = "error";
    syncError = new SyncError("ACCOUNT_MISMATCH", "This browser's local HabitFlow data is linked to another account. Export or reset local data before using a different account.");
    renderSyncStatus();
    return;
  }

  syncState = "syncing"; renderSyncStatus();
  try {
    const syncingUid = currentUser.uid;
    const [{ createFirestoreAdapter }] = await Promise.all([import("./services/firestore-sync.js")]);
    // Re-check the session after the lazy Firebase module loads.
    if (!currentUser || currentUser.uid !== syncingUid) {
      syncState = "idle";
      renderSyncStatus();
      if (currentUser) runSync();
      return;
    }
    await syncNow(createFirestoreAdapter(syncingUid), { passphrase: cfg.passphrase });
    localStorage.setItem(ownerKey, syncingUid);
    syncState = "idle"; syncError = null;
    await startRealtimeSync(syncingUid);
    renderAll();
    if (manual) showToast(t().syncDone);
    if (currentUser && currentUser.uid !== syncingUid) runSync();
  } catch (error) {
    console.error("HabitFlow Firestore sync failed:", error);
    syncState = "error"; syncError = error;
    if (manual) showToast(t().syncFailed);
  }
  renderSyncStatus();
  if (realtimeSyncPending && currentUser && loadSyncConfig().enabled) {
    realtimeSyncPending = false;
    Promise.resolve().then(() => runSync());
  }
}
function scheduleSync() {
  const cfg = loadSyncConfig();
  if (!cfg.enabled || !currentUser) return;
  clearTimeout(syncTimer); syncTimer = setTimeout(() => runSync(), 2500);
}
function loadSyncInputs() {
  const cfg = loadSyncConfig();
  $("#syncPassphrase").value = cfg.passphrase;
}
function connectSync() {
  if (!currentUser) { showToast(t().syncSignInRequired); return; }
  const passphrase = $("#syncPassphrase").value;
  if (!saveSyncConfig({ enabled: true, passphrase })) return;
  syncState = "idle"; syncError = null; showToast(t().syncSaved); runSync(true);
}
function disconnectSync() {
  stopRealtimeSync();
  clearTimeout(syncTimer);
  clearSyncConfig();
  loadSyncInputs();
  syncState = "idle"; syncError = null; showToast(t().syncDisconnected); renderSyncStatus();
}

/* ---------- events ---------- */
function bindEvents() {
  $$(".nav-link[data-view]").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
  $$("[data-go]").forEach(b => b.addEventListener("click", () => setView(b.dataset.go)));
  $("#addHabitBtn").addEventListener("click", () => openModal());
  $("#addHabitBtn2").addEventListener("click", () => openModal());
  $("#closeModal").addEventListener("click", () => closeModalEl($("#habitModal")));
  $("#cancelModal").addEventListener("click", () => closeModalEl($("#habitModal")));
  $("#closeDayModal").addEventListener("click", () => closeModalEl($("#dayModal")));
  $$(".modal-backdrop").forEach(el => el.addEventListener("click", e => { if (e.target === el) closeModalEl(el); }));
  $("#habitForm").addEventListener("submit", submitHabit);
  $("#habitCategory").addEventListener("change", e => { const isNew = e.target.value === "__new__"; $("#newCategory").hidden = !isNew; if (isNew) $("#newCategory").focus(); });
  $("#habitType").addEventListener("change", e => { $("#targetWrap").hidden = e.target.value !== "count"; });
  $("#daysPicker").addEventListener("click", e => { const b = e.target.closest(".day-option"); if (b) { b.classList.toggle("selected"); b.setAttribute("aria-pressed", b.classList.contains("selected")); } });

  for (const id of ["#todayHabits", "#allHabits", "#dayHabits"]) $(id).addEventListener("click", handleHabitAction);
  $("#dayHabits").addEventListener("change", e => {
    const input = e.target.closest("input[data-action='note']");
    if (input && setNote(input.dataset.id, input.dataset.date, input.value)) scheduleSync();
  });
  $("#calendarGrid").addEventListener("click", e => { const cell = e.target.closest(".calendar-cell[data-date]"); if (cell && !cell.disabled) openDayModal(cell.dataset.date); });

  $("#habitFilters").addEventListener("click", e => {
    const b = e.target.closest("[data-filter]"); if (!b) return;
    currentFilter = b.dataset.filter;
    $$(".filter-tab").forEach(x => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", x === b); });
    renderAll();
  });
  $("#categoryFilter").addEventListener("change", e => { currentCategory = e.target.value; renderAll(); });
  $("#habitSort").addEventListener("change", e => { sortBy = e.target.value; renderAll(); });
  $("#habitSearch").addEventListener("input", e => { searchQuery = e.target.value; renderAllHabits(getAllHabits()); });

  $("#languageToggle").addEventListener("click", () => { language = language === "en" ? "ar" : "en"; applyPreferences(); applyTranslations(); initDays(); });
  $("#themeToggle").addEventListener("click", () => { theme = theme === "dark" ? "light" : "dark"; applyPreferences(); });
  $$("[data-theme]").forEach(b => b.addEventListener("click", () => { theme = b.dataset.theme; applyPreferences(); }));
  $$("[data-lang]").forEach(b => b.addEventListener("click", () => { language = b.dataset.lang; applyPreferences(); applyTranslations(); initDays(); }));
  $("#prevMonth").addEventListener("click", () => { calendarDate.setMonth(calendarDate.getMonth() - 1); renderCalendar(getAllHabits()); });
  $("#nextMonth").addEventListener("click", () => { calendarDate.setMonth(calendarDate.getMonth() + 1); renderCalendar(getAllHabits()); });

  $("#syncSave").addEventListener("click", connectSync);
  $("#syncNow").addEventListener("click", () => runSync(true));
  $("#syncDisconnect").addEventListener("click", disconnectSync);
  $("#enableNotifications").addEventListener("click", enableNotifications);
  window.addEventListener("online", () => { if (syncState === "offline") syncState = "idle"; runSync(); });
  window.addEventListener("offline", () => { if (loadSyncConfig().enabled) { syncState = "offline"; renderSyncStatus(); } });

  $("#exportData").addEventListener("click", exportBackup);
  $("#importData").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", e => importBackup(e.target.files[0]));
  $("#resetData").addEventListener("click", resetAppData);
  $("#mobileMenu").addEventListener("click", () => { $("#sidebar").classList.add("open"); $("#mobileOverlay").classList.add("show"); });
  $("#mobileOverlay").addEventListener("click", closeSidebar);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") $$(".modal-backdrop.open").forEach(closeModalEl);
    trapFocus(e);
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // Service Workers require HTTPS (or localhost during development).
  navigator.serviceWorker.register("./service-worker.js", { scope: "./" })
    .catch(error => console.error("HabitFlow: Service Worker registration failed:", error));
}

function init() {
  applyPreferences(); initDays(); bindEvents(); loadSyncInputs(); applyTranslations();
  registerServiceWorker();
  runSync();
  checkReminders(); setInterval(checkReminders, 30000);

  // Keep the sidebar identity in sync with Firebase Authentication.
  watchAccount();
}
init();
