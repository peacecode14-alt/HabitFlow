"""
End-to-end UI tests (Playwright for Python + Chromium).
    pip install playwright && playwright install chromium
    python3 test/e2e.py
Starts a static server for the app and the reference sync server by itself.
"""
import json, os, re, subprocess, sys, tempfile, time, socket, http.server, threading, functools
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.environ.get("E2E_SHOTS")  # optional folder for screenshots

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-store"); super().end_headers()

app_port, sync_port = free_port(), free_port()
httpd = http.server.ThreadingHTTPServer(("127.0.0.1", app_port), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=httpd.serve_forever, daemon=True).start()
sync_dir = tempfile.mkdtemp(prefix="hf-e2e-")
sync = subprocess.Popen(["node", os.path.join(ROOT, "server/sync-server.js")], env={**os.environ, "PORT": str(sync_port), "DATA_DIR": sync_dir}, stdout=subprocess.DEVNULL)
time.sleep(0.6)
APP = f"http://localhost:{app_port}/index.html"
SYNC_URL = f"http://localhost:{sync_port}/sync"

passed, failed = 0, []
def check(name, fn):
    global passed
    try: fn(); passed += 1; print("  ✓", name)
    except Exception as e:
        failed.append(name); print("  ✗", name, "\n     ", str(e).strip().splitlines()[0][:300])

errors = []
def watch(page, label):
    page.on("pageerror", lambda e: errors.append(f"[{label}] pageerror: {e}"))
    def on_console(m):
        expected = "Wrong passphrase" in m.text  # logged on purpose by the wrong-passphrase test
        if m.type == "error" and not expected and "Failed to load resource" not in m.text and "fonts.g" not in m.text:
            errors.append(f"[{label}] console: {m.text}")
    page.on("console", on_console)

def new_page(ctx, label="page"):
    page = ctx.new_page(); watch(page, label)
    # No internet in the sandbox: block Google Fonts so the page does not wait on it.
    page.route(re.compile(r"https://fonts\.(googleapis|gstatic)\.com/.*"), lambda r: r.abort())
    return page

def shot(page, name):
    if SHOTS: os.makedirs(SHOTS, exist_ok=True); page.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=True)

def goto_view(page, view):
    page.click(f'.nav-link[data-view="{view}"]')

def ls(page, key="habitflow_data"):
    raw = page.evaluate("k => localStorage.getItem(k)", key)
    return json.loads(raw) if raw else None

def day_key(offset):
    return (datetime.now() + timedelta(days=offset)).strftime("%Y-%m-%d")

with sync_playwright() as pw:
    browser = pw.chromium.launch()

    # ------------------------------------------------------------------ first run, templates, counters
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, permissions=[])
    page = new_page(ctx, "main"); page.goto(APP)
    print("First run & templates")
    check("empty dashboard offers starter templates", lambda: expect(page.locator("#todayHabits .template-chip")).to_have_count(6))
    shot(page, "01-empty-templates")
    def add_water():
        page.click('#todayHabits .template-chip[data-key="water"]')
        expect(page.locator("#todayHabits .habit-item")).to_have_count(1)
        expect(page.locator("#todayHabits .counter-value")).to_have_text("0/8")
    check("clicking a template adds a counter habit", add_water)
    def count_to_target():
        for _ in range(8): page.click('#todayHabits [data-action="inc"]')
        expect(page.locator("#todayHabits .counter-value")).to_have_text("8/8")
        expect(page.locator("#todayHabits .habit-item")).to_have_class(re.compile("completed"))
        page.click('#todayHabits [data-action="dec"]')
        expect(page.locator("#todayHabits .counter-value")).to_have_text("7/8")
        expect(page.locator("#todayHabits .habit-item")).not_to_have_class(re.compile("completed"))
    check("counter reaches target, completes, and can be decreased", count_to_target)
    check("template chips disappear once a habit exists", lambda: expect(page.locator(".template-chip")).to_have_count(0))

    # ------------------------------------------------------------------ add habit modal, custom category
    print("Habit form, custom category, filters")
    def add_custom():
        page.click("#addHabitBtn")
        page.fill("#habitName", "Gym session")
        page.select_option("#habitCategory", "__new__")
        expect(page.locator("#newCategory")).to_be_visible()
        page.fill("#newCategory", "Fitness")
        page.fill("#habitReminder", "06:30")
        page.click("#saveHabitBtn")
        expect(page.locator("#habitModal")).not_to_have_class(re.compile("open"))
        expect(page.locator("#todayHabits .habit-item")).to_have_count(2)
    check("create habit with a brand-new category + reminder time", add_custom)
    def counter_form():
        page.click("#addHabitBtn")
        expect(page.locator("#targetWrap")).to_be_hidden()
        page.select_option("#habitType", "count")
        expect(page.locator("#targetWrap")).to_be_visible()
        page.fill("#habitName", "Pushups"); page.fill("#habitTarget", "30")
        page.select_option("#habitCategory", "Health")
        page.click("#saveHabitBtn")
        expect(page.locator('#todayHabits .habit-item:has-text("Pushups") .counter-value')).to_have_text("0/30")
    check("counter type shows a target field and saves it", counter_form)
    goto_view(page, "habits")
    def category_in_filter():
        opts = page.locator("#categoryFilter option").all_text_contents()
        assert opts[0] == "All Categories" and "Fitness" in opts and "Health" in opts, opts
    check("custom category appears in the category filter", category_in_filter)
    def combine_filters():
        page.select_option("#categoryFilter", "Health")
        expect(page.locator("#allHabits .habit-item")).to_have_count(2)   # water + pushups
        page.click('[data-filter="completed"]')
        expect(page.locator("#allHabits .habit-item")).to_have_count(0)    # none completed today
        expect(page.locator("#allHabits")).to_contain_text("No habits match")
        page.click('[data-filter="active"]')
        expect(page.locator("#allHabits .habit-item")).to_have_count(2)
        expect(page.locator('[data-filter="active"]')).to_have_attribute("aria-pressed", "true")
        expect(page.locator('[data-filter="all"]')).to_have_attribute("aria-pressed", "false")
    check("category + status filters combine (and report no-match)", combine_filters)
    def search_and_sort():
        page.click('[data-filter="all"]'); page.select_option("#categoryFilter", "all")
        page.fill("#habitSearch", "push")
        expect(page.locator("#allHabits .habit-item")).to_have_count(1)
        page.fill("#habitSearch", "fitness")            # matches by category name too
        expect(page.locator("#allHabits .habit-item")).to_have_count(1)
        page.fill("#habitSearch", "")
        page.select_option("#habitSort", "name")
        names = page.locator("#allHabits .habit-info strong").all_text_contents()
        assert names == sorted(names, key=str.lower), names
    check("search by name/category and sort by name", search_and_sort)
    shot(page, "02-habits-list")

    # ------------------------------------------------------------------ archive, delete + undo
    print("Archive, delete, undo")
    def archive_flow():
        page.click('#allHabits .habit-item:has-text("Pushups") [data-action="archive"]')
        expect(page.locator("#allHabits")).not_to_contain_text("Pushups")
        page.click('[data-filter="archived"]')
        expect(page.locator("#allHabits .habit-item.archived")).to_have_count(1)
        expect(page.locator("#statsGrid")).to_contain_text("2")  # 2 active habits remain
        page.click('#allHabits [data-action="restore"]')
        expect(page.locator("#allHabits")).to_contain_text("No archived")
        page.click('[data-filter="all"]')
        expect(page.locator("#allHabits")).to_contain_text("Pushups")
    check("archive hides a habit (kept in Archived tab) and restore brings it back", archive_flow)
    def delete_undo():
        page.click('#allHabits .habit-item:has-text("Pushups") [data-action="delete"]')
        expect(page.locator("#allHabits")).not_to_contain_text("Pushups")
        expect(page.locator("#toast")).to_contain_text("deleted")
        page.click("#toast .toast-action")
        expect(page.locator("#allHabits")).to_contain_text("Pushups")
        assert ls(page)["deleted"] == {}, "undo should remove the deletion record"
    check("delete shows an Undo action that restores the habit", delete_undo)

    # ------------------------------------------------------------------ calendar day editor, streak
    print("Calendar day editing, streaks")
    goto_view(page, "calendar")
    def edit_past_day():
        y = day_key(-1)
        if datetime.now().day == 1: page.click("#prevMonth")
        page.click(f'.calendar-cell[data-date="{y}"]')
        expect(page.locator("#dayModal")).to_have_class(re.compile("open"))
        expect(page.locator("#dayHabits .day-row")).to_have_count(3)
        page.click('#dayHabits .day-row:has-text("Gym session") [data-action="toggle"]')
        expect(page.locator('#dayHabits .day-row:has-text("Gym session") .habit-check')).to_have_class(re.compile("done"))
        page.fill('#dayHabits .day-row:has-text("Gym session") .day-note', "Leg day")
        page.keyboard.press("Tab")
        assert ls(page)["habits"][1]["log"][y]["n"] == "Leg day"
        page.keyboard.press("Escape")
        expect(page.locator("#dayModal")).not_to_have_class(re.compile("open"))
        assert y in next(h for h in ls(page)["habits"] if h["name"] == "Gym session")["completions"]
    check("click a past day: mark done + write a note, saved to the log", edit_past_day)
    def future_disabled():
        d = datetime.now() + timedelta(days=1)
        if d.month == datetime.now().month:
            expect(page.locator(f'.calendar-cell[data-date="{d.strftime("%Y-%m-%d")}"]')).to_be_disabled()
    check("future days are not clickable", future_disabled)
    def streak_shows():
        goto_view(page, "habits")
        page.click('#allHabits .habit-item:has-text("Gym session") [data-action="toggle"]')   # today
        expect(page.locator('#allHabits .habit-item:has-text("Gym session") small')).to_contain_text("🔥 2")
        goto_view(page, "statistics")
        expect(page.locator("#habitPerformance")).to_contain_text("100%")
        expect(page.locator("#statisticsSummary")).to_contain_text("2")
    check("per-habit streak (yesterday + today = 2) and schedule-aware rate (100%)", streak_shows)
    shot(page, "03-statistics")

    # ------------------------------------------------------------------ reminders
    print("Reminders")
    def reminder_fires():
        past = (datetime.now() - timedelta(minutes=1)).strftime("%H:%M")
        if datetime.now().hour == 0 and datetime.now().minute == 0: return
        goto_view(page, "habits")
        page.click('#allHabits .habit-item:has-text("Pushups") [data-action="edit"]')
        page.fill("#habitReminder", past); page.click("#saveHabitBtn")
        page.evaluate("sessionStorage.clear()")
        page.reload()
        expect(page.locator("#toast")).to_contain_text("Pushups")
    check("a due reminder shows inside the app", reminder_fires)
    def notif_status():
        goto_view(page, "settings")
        expect(page.locator("#reminderStatus")).not_to_be_empty()
        expect(page.locator("#enableNotifications")).to_be_visible()
    check("settings shows notification status", notif_status)

    # ------------------------------------------------------------------ backup export / import / reset
    print("Backup export, reset, import")
    page.on("dialog", lambda d: d.accept())
    exported = {}
    def export_backup():
        goto_view(page, "settings")
        with page.expect_download() as dl: page.click("#exportData")
        path = os.path.join(tempfile.mkdtemp(), "backup.json"); dl.value.save_as(path)
        exported["path"] = path; data = json.load(open(path))
        assert data["schemaVersion"] == 3 and len(data["habits"]) == 3, data["schemaVersion"]
    check("export produces a v3 backup with all habits", export_backup)
    def reset_then_import():
        page.click("#resetData")
        goto_view(page, "habits")
        expect(page.locator("#allHabits .template-chip")).to_have_count(6)
        goto_view(page, "settings")
        page.set_input_files("#importFile", exported["path"])
        expect(page.locator("#toast")).to_contain_text("imported")
        goto_view(page, "habits")
        expect(page.locator("#allHabits .habit-item")).to_have_count(3)
        gym = next(h for h in ls(page)["habits"] if h["name"] == "Gym session")
        assert day_key(-1) in gym["completions"] and gym["log"][day_key(-1)]["n"] == "Leg day", "history + notes restored"
        assert any(k.endswith("pre_import") for k in page.evaluate("Object.keys(localStorage)")), "safety snapshot kept"
    check("reset empties the app; import restores habits, history and notes", reset_then_import)
    def import_bad_file():
        bad = os.path.join(tempfile.mkdtemp(), "bad.json"); open(bad, "w").write('{"hello": 1}')
        goto_view(page, "settings"); page.set_input_files("#importFile", bad)
        expect(page.locator("#toast")).to_contain_text("not a HabitFlow backup")
    check("importing a wrong file shows a clear error and changes nothing", import_bad_file)

    # ------------------------------------------------------------------ legacy v1 data
    print("Legacy data")
    legacy = new_page(browser.new_context(viewport={"width": 1280, "height": 900}), "legacy")
    legacy.goto(APP)
    legacy.evaluate("""() => localStorage.setItem('habitflow_data', JSON.stringify({
      habits:[{id:'a', name:'Old habit', category:'Learning', icon:'📚', color:'#A78BFA', frequency:[0,1,2,3,4,5,6], createdAt:new Date(Date.now()-5*864e5).toISOString(), completions:[new Date(Date.now()-864e5).toLocaleDateString('en-CA')]}],
      settings:{language:'en', theme:'dark'}}))""")
    legacy.reload()
    def legacy_migrates():
        expect(legacy.locator("#todayHabits")).to_contain_text("Old habit")
        d = ls(legacy); assert d["schemaVersion"] == 3 and d["habits"][0]["log"], d
        assert "habitflow_data_backup_v1" in legacy.evaluate("Object.keys(localStorage)")
    check("a pre-versioning data file migrates on load, with a backup copy", legacy_migrates)

    # ------------------------------------------------------------------ language / RTL
    print("Arabic / RTL")
    def arabic():
        goto_view(page, "habits")
        page.click("#languageToggle")
        expect(page.locator("html")).to_have_attribute("dir", "rtl")
        expect(page.locator('[data-filter="archived"]')).to_have_text("المؤرشفة")
        expect(page.locator("#categoryFilter option").first).to_have_text("كل التصنيفات")
        assert "الصحة" in page.locator("#categoryFilter option").all_text_contents()
        shot(page, "04-arabic-rtl")
        page.click("#languageToggle"); expect(page.locator("html")).to_have_attribute("dir", "ltr")
    check("Arabic switches direction and translates the new controls", arabic)

    # ------------------------------------------------------------------ accessibility
    print("Accessibility")
    def modal_a11y():
        goto_view(page, "habits")
        page.click("#addHabitBtn2")
        expect(page.locator("#habitName")).to_be_focused()
        for _ in range(30): page.keyboard.press("Tab")
        inside = page.evaluate("document.activeElement.closest('.modal') !== null")
        assert inside, "focus escaped the modal"
        page.keyboard.press("Escape")
        expect(page.locator("#addHabitBtn2")).to_be_focused()
    check("modal traps focus, Escape closes it and focus returns", modal_a11y)
    def aria_basics():
        assert page.locator("a.skip-link").count() == 1
        expect(page.locator('.nav-link.active')).to_have_attribute("aria-current", "page")
        names = page.evaluate("""() => [...document.querySelectorAll('button')].filter(b => b.offsetParent && !(b.textContent.trim() || b.getAttribute('aria-label') || b.title)).length""")
        assert names == 0, f"{names} visible buttons have no accessible name"
        expect(page.locator("#allHabits .habit-check").first).to_have_attribute("aria-pressed", re.compile("true|false"))
    check("skip link, aria-current, named buttons, aria-pressed on checks", aria_basics)

    # ------------------------------------------------------------------ PWA
    print("PWA")
    def pwa():
        m = json.loads(page.evaluate("fetch('manifest.json').then(r => r.text())"))
        assert {i["sizes"] for i in m["icons"]} >= {"192x192", "512x512"} and any(i["purpose"] == "maskable" for i in m["icons"])
        for i in m["icons"]:
            assert page.evaluate("src => fetch(src).then(r => r.status)", i["src"]) == 200, i["src"]
        page.wait_for_function("navigator.serviceWorker.ready.then(() => true)")
    check("manifest has 192/512/maskable icons that load; service worker ready", pwa)
    def offline():
        page.reload(); page.wait_for_function("navigator.serviceWorker.controller !== null")
        ctx.set_offline(True)
        page.reload(); expect(page.locator("#todayHabits .habit-item").first).to_be_visible()
        ctx.set_offline(False)
    check("app shell works offline after the first visit", offline)

    # ------------------------------------------------------------------ cloud sync across two browsers, encrypted
    print("Cloud sync (two browsers, encrypted)")
    ctxA = browser.new_context(viewport={"width": 1280, "height": 900}); A = new_page(ctxA, "A"); A.goto(APP)
    ctxB = browser.new_context(viewport={"width": 1280, "height": 900}); B = new_page(ctxB, "B"); B.goto(APP)
    for p in (A, B): p.on("dialog", lambda d: d.accept())
    def connect(p, passphrase="swordfish!"):
        goto_view(p, "settings")
        p.fill("#syncUrl", SYNC_URL); p.fill("#syncToken", "e2e-token-1234"); p.fill("#syncPassphrase", passphrase)
        p.click("#syncSave")
    def a_creates_and_syncs():
        A.click('#todayHabits .template-chip[data-key="read"]')
        connect(A)
        expect(A.locator("#syncStatus")).to_contain_text("Last synced", timeout=8000)
        stored = open(os.path.join(sync_dir, os.listdir(sync_dir)[0])).read()
        assert '"enc":1' in stored.replace(" ", "") and "Read 10 pages" not in stored, "server must only see ciphertext"
    check("A creates a habit and syncs; the server stores only ciphertext", a_creates_and_syncs)
    def b_pulls():
        connect(B)
        expect(B.locator("#syncStatus")).to_contain_text("Last synced", timeout=8000)
        goto_view(B, "habits"); expect(B.locator("#allHabits")).to_contain_text("Read 10 pages")
    check("B connects with the same passphrase and receives it", b_pulls)
    def wrong_passphrase():
        C = new_page(browser.new_context(), "C"); C.goto(APP); goto_view(C, "settings")
        C.fill("#syncUrl", SYNC_URL); C.fill("#syncToken", "e2e-token-1234"); C.fill("#syncPassphrase", "wrong"); C.click("#syncSave")
        expect(C.locator("#syncStatus")).to_contain_text("Wrong passphrase", timeout=8000)
        goto_view(C, "habits"); expect(C.locator("#allHabits .habit-item")).to_have_count(0)
    check("a wrong passphrase is rejected and nothing is imported", wrong_passphrase)
    def per_day_merge():
        yA, yB = day_key(-2), day_key(-3)
        for p, d in ((A, yA), (B, yB)):
            goto_view(p, "calendar")
            if datetime.now().day <= 3: p.click("#prevMonth")
            p.click(f'.calendar-cell[data-date="{d}"]')
            p.click('#dayHabits [data-action="toggle"]'); p.keyboard.press("Escape")
        A.click('[data-view="settings"]'); A.click("#syncNow"); expect(A.locator("#toast")).to_contain_text("Sync complete")
        B.click('[data-view="settings"]'); B.click("#syncNow"); expect(B.locator("#toast")).to_contain_text("Sync complete")
        A.click("#syncNow"); expect(A.locator("#syncStatus")).to_contain_text("Last synced")
        for p in (A, B):
            comp = next(h for h in ls(p)["habits"] if h["name"] == "Read 10 pages")["completions"]
            assert yA in comp and yB in comp, f"both days must survive on both devices: {comp}"
    check("different days recorded on two devices are BOTH kept after syncing", per_day_merge)
    def delete_propagates():
        goto_view(A, "habits"); A.click('#allHabits .habit-item [data-action="delete"]')
        expect(A.locator("#allHabits .habit-item")).to_have_count(0)
        goto_view(A, "settings"); A.click("#syncNow"); expect(A.locator("#toast")).to_contain_text("Sync complete")
        goto_view(B, "settings"); B.click("#syncNow"); expect(B.locator("#toast")).to_contain_text("Sync complete")
        goto_view(B, "habits"); expect(B.locator("#allHabits .habit-item")).to_have_count(0)
    check("a deletion on A removes the habit on B", delete_propagates)

    # ------------------------------------------------------------------ mobile
    print("Mobile layout")
    mob = new_page(browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True), "mobile"); mob.goto(APP)
    mob.click('#todayHabits .template-chip[data-key="water"]')
    def no_overflow():
        for view in ("habits", "calendar", "statistics", "settings"):
            mob.click("#mobileMenu"); mob.click(f'.nav-link[data-view="{view}"]')
            w = mob.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
            assert w[0] <= w[1] + 1, f"{view}: horizontal overflow {w}"
        mob.click("#mobileMenu"); mob.click('.nav-link[data-view="habits"]'); shot(mob, "05-mobile-habits")
    check("no horizontal overflow on any screen at 390px", no_overflow)

    browser.close()

sync.terminate(); httpd.shutdown()
print("\nConsole/page errors during the run:", len(errors))
for e in errors[:15]: print("  -", e)
print(f"\n{passed} passed, {len(failed)} failed")
sys.exit(1 if failed or errors else 0)
