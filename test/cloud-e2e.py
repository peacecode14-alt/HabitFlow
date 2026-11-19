"""
Browser tests for the account, cloud-sync and reminder flows, with Firebase and the reminder backend replaced by
in-memory stubs (no network, no real accounts).   Run: python3 test/cloud-e2e.py   (needs `pip install playwright`)
"""
import json, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
PORT = "8765"
BASE = f"http://127.0.0.1:{PORT}"
srv = subprocess.Popen([sys.executable, "-m", "http.server", PORT, "--bind", "127.0.0.1", "--directory", str(ROOT)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)

STORE, WRITES, REMINDER_POSTS = {}, [], []          # fake Firestore + captured reminder requests
fs_get = lambda path: STORE.get(path)
def fs_set(path, value): STORE[path] = value; WRITES.append(path)
def fs_del(path): STORE.pop(path, None)

FIRESTORE = """export const getFirestore=()=>({});
export const doc=(db,...p)=>({path:p.join('/')});
export const getDoc=async r=>{const v=await window.fsGet(r.path);return {exists:()=>v!=null,data:()=>JSON.parse(v)}};
const subs=[];
export const setDoc=async(r,d)=>{await window.fsSet(r.path,JSON.stringify({...d,updatedAt:'ts'}));setTimeout(()=>subs.forEach(f=>f()),20)};
export const deleteDoc=async r=>{await window.fsDel(r.path);setTimeout(()=>subs.forEach(f=>f()),20)};
export const serverTimestamp=()=>'ts';
export const onSnapshot=(r,cb)=>{subs.push(cb);setTimeout(cb,10);return ()=>{const i=subs.indexOf(cb);if(i>=0)subs.splice(i,1)}};"""
MESSAGING = 'export const getMessaging=()=>({});export const getToken=async()=>"tok-"+"x".repeat(40);export const isSupported=async()=>true;'

def auth_module(uid, verified=True):
    user = f'{{uid:"{uid}",email:"{uid}@x.y",displayName:"{uid}",emailVerified:{str(verified).lower()},getIdToken:async()=>"id-token-{uid}"}}'
    return f"""window.__mails=window.__mails||0;const cur={{u:{user}}};
export const getAuth=()=>({{get currentUser(){{return cur.u}}}});
export const onAuthStateChanged=(a,cb)=>{{window.__cb=cb;setTimeout(()=>cb(cur.u),0);return ()=>{{}}}};
export const signOut=async()=>{{cur.u=null;window.__cb&&window.__cb(null)}};
export const reload=async()=>{{}};export const updateProfile=async()=>{{}};
export const signInWithEmailAndPassword=async()=>{{cur.u={user};window.__cb&&window.__cb(cur.u);return {{user:cur.u}}}};
export const createUserWithEmailAndPassword=async()=>({{user:{{}}}});
export const sendEmailVerification=async()=>{{window.__mails++}};export const sendPasswordResetEmail=async()=>{{}};
export const confirmPasswordReset=async()=>{{}};export const applyActionCode=async()=>{{}};"""

def new_device(browser, uid, verified=True, start_signed_in=True, notifications=False):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    ctx.expose_function("fsGet", fs_get); ctx.expose_function("fsSet", fs_set); ctx.expose_function("fsDel", fs_del)
    auth = auth_module(uid, verified)
    if not start_signed_in:
        auth = auth.replace("const cur={u:", "const cur={u:null,_x:", 1)
    def firebase(route):
        u = route.request.url
        body = ("export const initializeApp=()=>({});" if "firebase-app" in u else FIRESTORE if "firestore" in u
                else MESSAGING if "messaging" in u else auth)
        route.fulfill(status=200, content_type="text/javascript", headers={"access-control-allow-origin": "*"}, body=body)
    ctx.route("https://www.gstatic.com/**", firebase)
    ctx.route("https://fonts.*/**", lambda r: r.abort())
    def reminders(route):
        req = route.request
        if req.method == "POST": REMINDER_POSTS.append(json.loads(req.post_data or "{}"))
        route.fulfill(status=200, content_type="application/json", body='{"ok":true,"schedulesSynced":0}',
                      headers={"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST,OPTIONS"})
    ctx.route("https://yylgyambooemhfpbcnpi.supabase.co/**", reminders)
    if notifications:
        ctx.add_init_script("Object.defineProperty(Notification,'permission',{get:()=>'granted'})")
    page = ctx.new_page(); errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: d.accept())
    return ctx, page, errors

results = []
def check(name, fn):
    try: fn(); results.append(("PASS", name))
    except Exception as e: results.append(("FAIL", f"{name} -> {str(e)[:300]}"))

def connect(page, passphrase):
    page.click('[data-view="settings"]'); page.fill("#syncPassphrase", passphrase); page.click("#syncSave")

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------------- cloud sync ----------------
    ctxA, A, errA = new_device(b, "alice"); A.goto(BASE + "/index.html"); A.wait_for_timeout(500)
    ctxB, B, errB = new_device(b, "alice"); B.goto(BASE + "/index.html"); B.wait_for_timeout(500)

    def a_syncs():
        A.click('#todayHabits .template-chip[data-key="read"]'); connect(A, "swordfish!")
        expect(A.locator("#syncStatus")).to_contain_text("Last synced", timeout=8000)
        stored = STORE["users/alice/sync/state"]
        assert '"enc":1' in stored.replace(" ", "") and "Read 10 pages" not in stored, "cloud copy must be ciphertext"
    check("device A syncs; the cloud copy is encrypted", a_syncs)

    def b_receives():
        connect(B, "swordfish!"); expect(B.locator("#syncStatus")).to_contain_text("Last synced", timeout=8000)
        B.click('[data-view="habits"]'); expect(B.locator("#allHabits")).to_contain_text("Read 10 pages")
    check("device B (same account + passphrase) receives the habit", b_receives)

    def wrong_passphrase():
        ctx, C, _ = new_device(b, "alice"); C.goto(BASE + "/index.html"); C.wait_for_timeout(400)
        connect(C, "nope"); expect(C.locator("#syncStatus")).to_contain_text("Wrong passphrase", timeout=8000)
        C.click('[data-view="habits"]'); expect(C.locator("#allHabits .habit-item")).to_have_count(0); ctx.close()
    check("a wrong passphrase is rejected and nothing is imported", wrong_passphrase)

    def other_account():
        ctx, D, _ = new_device(b, "bob"); D.goto(BASE + "/index.html"); D.wait_for_timeout(400)
        connect(D, "x"); expect(D.locator("#syncStatus")).to_contain_text("Last synced", timeout=8000)
        D.click('[data-view="habits"]'); expect(D.locator("#allHabits .habit-item")).to_have_count(0)
        assert "users/bob/sync/state" in STORE; ctx.close()
    check("another account gets its own document and sees none of Alice's habits", other_account)

    def no_write_loop():
        before = len(WRITES); A.wait_for_timeout(3000); assert len(WRITES) == before, "idle device must not keep writing"
    check("an idle, connected device does not write in a loop", no_write_loop)

    def language_no_write():
        before = len(WRITES); A.click("#languageToggle"); A.wait_for_timeout(1500)
        assert len(WRITES) == before, "switching language must not cause a cloud write"
    check("switching language does not write to the cloud", language_no_write)

    def delete_cloud():
        A.click('[data-view="settings"]'); A.click("#syncDeleteCloud"); A.wait_for_timeout(1200)
        assert "users/alice/sync/state" not in STORE, "cloud copy should be gone"
        # sync is switched off, so the realtime listener must not re-create the document
        A.wait_for_timeout(2500); assert "users/alice/sync/state" not in STORE, "document was re-created after deletion"
        A.click('[data-view="habits"]'); expect(A.locator("#allHabits")).to_contain_text("Read 10 pages")   # local data kept
    check("'Delete cloud copy' removes the document, turns sync off, keeps local data", delete_cloud)
    ctxA.close(); ctxB.close()

    # ---------------- reminders ----------------
    ctxR, R, errR = new_device(b, "carol", notifications=True); R.goto(BASE + "/index.html"); R.wait_for_timeout(4000)
    def reminders_dedupe():
        n0 = len(REMINDER_POSTS); assert n0 >= 1, "expected the first reminder sync after sign-in"
        R.click('#todayHabits .template-chip[data-key="read"]'); R.wait_for_timeout(4000)
        n1 = len(REMINDER_POSTS)
        R.locator("#todayHabits .habit-check").first.click(); R.wait_for_timeout(4000)
        n2 = len(REMINDER_POSTS)
        assert n1 == n0 and n2 == n1, f"completing/adding a habit without a reminder must not call the server ({n0}->{n1}->{n2})"
    check("reminder sync is skipped when the schedule did not change", reminders_dedupe)

    def reminders_language():
        n = len(REMINDER_POSTS); R.click("#languageToggle"); R.wait_for_timeout(4000)
        assert len(REMINDER_POSTS) == n + 1 and REMINDER_POSTS[-1]["language"] in ("ar", "en"), "language change should refresh the server text once"
    check("a language change re-sends reminders once, with the language", reminders_language)

    def reset_unregisters():
        R.click('[data-view="settings"]'); n = len(REMINDER_POSTS)
        R.click("#resetData"); R.wait_for_timeout(1500)
        assert any(x.get("action") == "unregister" for x in REMINDER_POSTS[n:]), "reset must unregister the device"
    check("'Reset all data' unregisters this device from reminders", reset_unregisters)
    ctxR.close()

    # ---------------- account page ----------------
    ctxS, S, errS = new_device(b, "dave", notifications=True); S.goto(BASE + "/index.html"); S.wait_for_timeout(3500)
    S.click('#todayHabits .template-chip[data-key="read"]'); S.wait_for_timeout(500)
    S.evaluate("localStorage.setItem('habitflow_cloud_owner','dave')")   # this browser is linked to a cloud account
    S.goto(BASE + "/auth.html"); S.wait_for_timeout(700)
    def signout_unregisters_and_wipes():
        assert S.evaluate("localStorage.getItem('habitflow_push_token')"), "device should have a stored push token"
        n = len(REMINDER_POSTS)
        S.click("#signOutButton"); S.wait_for_timeout(1000)           # the confirm dialog is auto-accepted
        assert any(x.get("action") == "unregister" for x in REMINDER_POSTS[n:]), "sign-out must unregister the device"
        assert S.evaluate("localStorage.getItem('habitflow_push_token')") is None
        assert S.evaluate("localStorage.getItem('habitflow_cloud_owner')") is None, "owner marker should be cleared"
        assert S.evaluate("(JSON.parse(localStorage.getItem('habitflow_data')||'{\"habits\":[]}').habits||[]).length") == 0, "local habits should be wiped when accepted"
    check("signing out unregisters reminders and (when accepted) wipes this device's data", signout_unregisters_and_wipes)
    ctxS.close()

    def resend_verification():
        ctx, V, _ = new_device(b, "erin", verified=False, start_signed_in=False); V.goto(BASE + "/auth.html"); V.wait_for_timeout(500)
        V.fill("#email", "erin@x.y"); V.fill("#password", "Passw0rd1"); V.click("#submitButton"); V.wait_for_timeout(700)
        assert V.locator("#resendVerificationButton").is_visible()
        assert V.evaluate("window.__mails") == 0, "no email is sent automatically"
        V.click("#resendVerificationButton"); V.wait_for_timeout(700)
        assert V.evaluate("window.__mails") == 1; ctx.close()
    check("unverified sign-in offers a resend button and sends nothing automatically", resend_verification)

    def offline_error_text():
        ctx, O, _ = new_device(b, "frank"); O.route("https://www.gstatic.com/**", lambda r: r.abort())
        O.goto(BASE + "/index.html"); O.wait_for_timeout(800)
        assert O.locator(".template-chip").count() > 0, "tracker must render with the Firebase CDN unreachable"; ctx.close()
    check("tracker still renders when the Firebase CDN is unreachable", offline_error_text)

    b.close()
srv.terminate()
for r in results: print(*r)
failed = [r for r in results if r[0] == "FAIL"]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
