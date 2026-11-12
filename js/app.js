import { APP_CONFIG } from "./config.js";
import { translations } from "./translations.js";
import { loadData, saveData, clearData } from "./storage.js";
import { getAllHabits, addHabit, updateHabit, deleteHabit, toggleCompletion, replaceHabits } from "./habits.js";

let data = loadData();
let language = data.settings.language;
let theme = data.settings.theme;
let currentView = "dashboard";
let currentFilter = "all";
let calendarDate = new Date();
let editingId = null;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const t = () => translations[language];
const dateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const today = () => dateKey(new Date());
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const scheduled = (habit, date = new Date()) => (habit.frequency || []).includes(date.getDay());
const doneOn = (habit, date = today()) => (habit.completions || []).includes(date);
const categoryName = value => t()[String(value).toLowerCase()] || value;
const persistSettings = () => saveData({ habits: getAllHabits(), settings: { language, theme } });

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
    const key = el.dataset.i18n;
    if (typeof t()[key] === "string") el.textContent = t()[key];
  });
  $("#topDate").textContent = new Intl.DateTimeFormat(language === "ar" ? "ar-EG" : "en-US", { weekday:"short", month:"short", day:"numeric" }).format(new Date());
  $("#year").textContent = new Date().getFullYear();
  $("#pageTitle").textContent = t()[currentView === "habits" ? "myHabits" : currentView] || t().dashboard;
  renderAll();
}
function showToast(message) {
  const toast = $("#toast"); toast.textContent = message; toast.classList.add("show");
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}
function setView(view) {
  currentView = view;
  $$(".view").forEach(el => el.classList.toggle("active", el.id === `${view}View`));
  $$(".nav-link[data-view]").forEach(el => el.classList.toggle("active", el.dataset.view === view));
  $("#pageTitle").textContent = t()[view === "habits" ? "myHabits" : view] || t().dashboard;
  closeSidebar(); renderAll();
}
function closeSidebar() { $("#sidebar").classList.remove("open"); $("#mobileOverlay").classList.remove("show"); }
function statsFor(date = today()) {
  const habits = getAllHabits().filter(h => scheduled(h, new Date(`${date}T12:00:00`)));
  const completed = habits.filter(h => doneOn(h, date)).length;
  return { total: habits.length, completed, remaining: habits.length-completed, percent: habits.length ? Math.round(completed/habits.length*100) : 0 };
}
function currentStreak() {
  const habits = getAllHabits(); if (!habits.length) return 0;
  let streak = 0; const d = new Date();
  for (let i=0;i<365;i++) {
    const key = dateKey(d); const due = habits.filter(h => scheduled(h,d));
    if (due.length && due.every(h => doneOn(h,key))) streak++;
    else if (due.length) break;
    d.setDate(d.getDate()-1);
  }
  return streak;
}
function statCard(label, value, foot, icon) {
  return `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></article>`;
}
function renderStats() {
  const s = statsFor();
  const cards = [
    statCard(t().todayProgress, `${s.percent}%`, `${s.completed} ${t().completed.toLowerCase()} · ${s.remaining} ${t().remaining.toLowerCase()}`, "◷"),
    statCard(t().completed, s.completed, t().percentDone, "✓"),
    statCard(t().currentStreak, currentStreak(), t().streakUnit, "↗"),
    statCard(t().totalHabits, getAllHabits().length, t().habitsCount, "◈")
  ].join("");
  $("#statsGrid").innerHTML = cards;
  $("#statisticsSummary").innerHTML = cards;
}
function habitMarkup(h, date = today()) {
  const done = doneOn(h,date);
  return `<article class="habit-item ${done ? "completed" : ""}" data-id="${escapeHTML(h.id)}">
    <span class="habit-color" style="background:${escapeHTML(h.color)}"></span><span class="habit-emoji">${escapeHTML(h.icon)}</span>
    <div class="habit-info"><strong>${escapeHTML(h.name)}</strong><small><span class="category-dot" style="background:${escapeHTML(h.color)}"></span>${escapeHTML(categoryName(h.category))}</small></div>
    <button class="habit-check ${done ? "done" : ""}" data-action="toggle" data-id="${escapeHTML(h.id)}" aria-label="${done ? "Undo completion" : "Complete habit"}">${done ? "✓" : ""}</button>
    <div class="habit-actions"><button class="mini-action" data-action="edit" data-id="${escapeHTML(h.id)}" title="${t().edit}">✎</button><button class="mini-action" data-action="delete" data-id="${escapeHTML(h.id)}" title="${t().delete}">⌫</button></div>
  </article>`;
}
function emptyState(title, desc, button = false) {
  return `<div class="no-habits"><div class="empty-icon">✧</div><h3>${title}</h3><p>${desc}</p>${button ? `<button class="primary-button" data-action="new">＋ ${t().createFirst}</button>` : ""}</div>`;
}
function renderTodayHabits() {
  const list = getAllHabits().filter(h => scheduled(h));
  $("#todayHabits").innerHTML = list.length ? list.map(h=>habitMarkup(h)).join("") : emptyState(t().noToday,t().noTodayDesc,true);
}
function renderAllHabits() {
  let list = getAllHabits();
  if (currentFilter === "active") list = list.filter(h => !doneOn(h));
  if (currentFilter === "completed") list = list.filter(h => doneOn(h));
  $("#habitCount").textContent = `${list.length} / ${getAllHabits().length}`;
  $("#allHabits").innerHTML = list.length ? list.map(h=>habitMarkup(h)).join("") : emptyState(t().noHabits,t().noHabitsDesc,true);
}
function weekDates() {
  return Array.from({length:7},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()-6+i); return d; });
}
function chartMarkup(container, dates) {
  container.innerHTML = dates.map(d=>{
    const key=dateKey(d), s=statsFor(key), label=t().days[d.getDay()];
    return `<div class="chart-day"><div class="bar-track" title="${s.completed}/${s.total}"><div class="bar-fill" style="height:${s.percent}%"></div></div><small>${label}</small></div>`;
  }).join("");
}
function renderCharts() {
  chartMarkup($("#weeklyChart"),weekDates()); chartMarkup($("#statsChart"),weekDates());
  const habits=getAllHabits();
  $("#habitPerformance").innerHTML = habits.length ? habits.map(h=>{
    const completed=(h.completions||[]).length, percent=Math.min(100,Math.round(completed/Math.max(1,daysSince(h.createdAt))*100));
    return `<div class="performance-row"><strong>${escapeHTML(h.icon)} ${escapeHTML(h.name)}</strong><small>${completed} ${t().completed.toLowerCase()}</small><div class="performance-track"><div class="performance-fill" style="width:${percent}%"></div></div></div>`;
  }).join("") : `<div class="empty-state">${t().noData}</div>`;
}
function daysSince(iso) { return Math.max(1,Math.floor((Date.now()-new Date(iso).getTime())/86400000)+1); }
function renderCalendar() {
  const year=calendarDate.getFullYear(), month=calendarDate.getMonth();
  $("#calendarMonth").textContent = new Intl.DateTimeFormat(language==="ar"?"ar-EG":"en-US",{month:"long",year:"numeric"}).format(calendarDate);
  const first=new Date(year,month,1).getDay(), count=new Date(year,month+1,0).getDate();
  const habits=getAllHabits();
  let html=t().weekdays.map(d=>`<div class="calendar-cell weekday">${d}</div>`).join("");
  for(let i=0;i<first;i++) html+=`<div class="calendar-cell" aria-hidden="true"></div>`;
  for(let day=1;day<=count;day++){
    const d=new Date(year,month,day), key=dateKey(d), due=habits.filter(h=>scheduled(h,d)), done=due.filter(h=>doneOn(h,key)).length;
    const cls=[key===today()?"today":"",done>0?"has-progress":"",due.length>0&&done===due.length?"perfect":""].filter(Boolean).join(" ");
    html+=`<div class="calendar-cell ${cls}" title="${done}/${due.length}"><span>${day}</span>${done?'<i class="day-dot"></i>':""}</div>`;
  }
  $("#calendarGrid").innerHTML=html;
}
function renderAll() {
  renderStats(); renderTodayHabits(); renderAllHabits(); renderCharts(); renderCalendar();
}
function openModal(id = null) {
  editingId=id; const form=$("#habitForm"); form.reset();
  const habit=id ? getAllHabits().find(h=>h.id===id) : null;
  $("#modalTitle").textContent=habit?t().editHabit:t().newHabit;
  $("#habitName").value=habit?.name||"";
  $("#habitCategory").value=habit?.category||"Health";
  $("#habitIcon").value=habit?.icon||"✦";
  $$('input[name="color"]').forEach(input=>input.checked=input.value===(habit?.color||"#42D9F5"));
  const selected=habit?.frequency||[0,1,2,3,4,5,6];
  $$(".day-option").forEach(b=>b.classList.toggle("selected",selected.includes(Number(b.dataset.day))));
  $("#habitModal").classList.add("open"); $("#habitModal").setAttribute("aria-hidden","false"); $("#habitName").focus();
}
function closeModal() { $("#habitModal").classList.remove("open"); $("#habitModal").setAttribute("aria-hidden","true"); editingId=null; }
function initDays() {
  $("#daysPicker").innerHTML=t().days.map((day,i)=>`<button type="button" class="day-option selected" data-day="${i}">${day}</button>`).join("");
}
function refreshDayLabels() {
  $$(".day-option").forEach((b,i)=>b.textContent=t().days[i]);
}
function handleHabitAction(event) {
  const button=event.target.closest("[data-action]"); if(!button)return;
  const {action,id}=button.dataset;
  if(action==="new"){openModal();return;}
  const habit=getAllHabits().find(h=>h.id===id); if(!habit)return;
  if(action==="toggle"){
    const wasDone=doneOn(habit);
    if(toggleCompletion(id)) { showToast(wasDone?t().habitUncompleted:t().habitCompleted); renderAll(); }
  }
  if(action==="edit") openModal(id);
  if(action==="delete" && confirm(t().confirmDelete)) { if(deleteHabit(id)){showToast(t().habitDeleted);renderAll();} }
}
function submitHabit(event) {
  event.preventDefault();
  const name=$("#habitName").value.trim();
  const frequency=$$(".day-option.selected").map(b=>Number(b.dataset.day));
  if(!name){showToast(t().nameRequired);return;}
  if(!frequency.length){showToast(t().chooseDay);return;}
  const payload={name,category:$("#habitCategory").value,icon:$("#habitIcon").value,color:$('input[name="color"]:checked').value,frequency};
  const ok=editingId?updateHabit(editingId,payload):addHabit(payload);
  if(ok){showToast(editingId?t().habitUpdated:t().habitAdded);closeModal();renderAll();}
}
function exportBackup() {
  const blob=new Blob([JSON.stringify({app:APP_CONFIG.name,version:APP_CONFIG.version,exportedAt:new Date().toISOString(),...loadData()},null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob), a=document.createElement("a"); a.href=url; a.download=t().exportFilename; a.click(); URL.revokeObjectURL(url); showToast(t().dataExported);
}
function resetAppData() {
  if(!confirm(t().confirmReset))return;
  clearData(); replaceHabits([]); language=APP_CONFIG.defaultLanguage; theme=APP_CONFIG.defaultTheme; persistSettings(); applyPreferences(); applyTranslations(); showToast(t().dataReset);
}
function bindEvents() {
  $$(".nav-link[data-view]").forEach(b=>b.addEventListener("click",()=>setView(b.dataset.view)));
  $$("[data-go]").forEach(b=>b.addEventListener("click",()=>setView(b.dataset.go)));
  $("#addHabitBtn").addEventListener("click",()=>openModal()); $("#addHabitBtn2").addEventListener("click",()=>openModal());
  $("#closeModal").addEventListener("click",closeModal); $("#cancelModal").addEventListener("click",closeModal);
  $("#habitModal").addEventListener("click",e=>{if(e.target===$("#habitModal"))closeModal();});
  $("#habitForm").addEventListener("submit",submitHabit);
  $("#daysPicker").addEventListener("click",e=>{const b=e.target.closest(".day-option");if(b)b.classList.toggle("selected");});
  $("#todayHabits").addEventListener("click",handleHabitAction); $("#allHabits").addEventListener("click",handleHabitAction);
  $("#habitFilters").addEventListener("click",e=>{const b=e.target.closest("[data-filter]");if(!b)return;currentFilter=b.dataset.filter;$$(".filter-tab").forEach(x=>x.classList.toggle("active",x===b));renderAllHabits();});
  $("#languageToggle").addEventListener("click",()=>{language=language==="en"?"ar":"en";applyPreferences();applyTranslations();initDays();});
  $("#themeToggle").addEventListener("click",()=>{theme=theme==="dark"?"light":"dark";applyPreferences();});
  $$("[data-theme]").forEach(b=>b.addEventListener("click",()=>{theme=b.dataset.theme;applyPreferences();}));
  $$("[data-lang]").forEach(b=>b.addEventListener("click",()=>{language=b.dataset.lang;applyPreferences();applyTranslations();initDays();}));
  $("#prevMonth").addEventListener("click",()=>{calendarDate.setMonth(calendarDate.getMonth()-1);renderCalendar();});
  $("#nextMonth").addEventListener("click",()=>{calendarDate.setMonth(calendarDate.getMonth()+1);renderCalendar();});
  $("#exportData").addEventListener("click",exportBackup); $("#resetData").addEventListener("click",resetAppData);
  $("#mobileMenu").addEventListener("click",()=>{$("#sidebar").classList.add("open");$("#mobileOverlay").classList.add("show");});
  $("#mobileOverlay").addEventListener("click",closeSidebar);
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal();});
}
function init() {
  applyPreferences(); initDays(); bindEvents(); applyTranslations();
}
init();
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("./service-worker.js")
            .then(registration => {
                console.log(
                    "Service Worker registered:",
                    registration.scope
                );
            })
            .catch(error => {
                console.error(
                    "Service Worker registration failed:",
                    error
                );
            });
    });
}
