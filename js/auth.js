import { auth } from "./firebase-client.js";
import { loadData, clearData } from "./storage.js";
import { clearSyncConfig } from "./services/sync.js";
import { unregisterDevice } from "./services/reminders-server.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  confirmPasswordReset,
  applyActionCode,
  signOut,
  onAuthStateChanged,
  reload,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

const $ = (id) => document.getElementById(id);
const state = { mode: "signin", busy: false, recovering: false };
const stored = (() => {
  try {
    return JSON.parse(localStorage.getItem("habitflow_data") || "{}");
  } catch {
    return {};
  }
})();
let language = stored?.settings?.language === "ar" ? "ar" : "en";
// Follow the theme chosen in the app so the account page matches the dashboard.
document.documentElement.dataset.theme =
  stored?.settings?.theme === "light" ? "light" : "dark";
const copy = {
  en: {
    eyebrow: "YOUR HABITS, YOUR ACCOUNT",
    signinTitle: "Welcome back",
    signupTitle: "Create your account",
    signinSubtitle: "Sign in to your HabitFlow account.",
    signupSubtitle: "Start building a routine that belongs to you.",
    signin: "Sign in",
    signup: "Create account",
    name: "Name",
    email: "Email address",
    password: "Password",
    confirm: "Confirm password",
    forgot: "Forgot password?",
    back: "Back to HabitFlow",
    continue: "Continue to HabitFlow",
    signout: "Sign out",
    note: "Your account is secured by Firebase. Enable Cloud Sync in HabitFlow to keep your habits synced across your devices.",
    required: "Please complete all required fields.",
    mismatch: "Passwords do not match.",
    weak: "Password must contain at least 8 characters.",
    created:
      "Account created. Check your email and verify your address before signing in.",
    signedIn: "Signed in successfully.",
    resetSent: "Password reset email sent. Check your inbox.",
    signedOut: "You have been signed out.",
    failed: "Something went wrong. Please try again.",
    already: "You are already signed in as",
    busy: "Please wait…",
    newPassword: "New password",
    confirmNewPassword: "Confirm new password",
    savePassword: "Save new password",
    passwordRules:
      "Use at least 8 characters, including a letter and a number.",
    passwordSaved: "Your password has been updated. You can sign in now.",
    invalidCredential: "The email or password is incorrect.",
    emailInUse: "This email is already registered. Try signing in instead.",
    invalidEmail: "Please enter a valid email address.",
    tooMany: "Too many attempts. Wait a moment and try again.",
    network: "Can't reach the network. Check your connection and try again.",
    expiredCode:
      "This link has expired or was already used. Request a new one.",
    disabled: "This account has been disabled.",
    verified: "Your email is verified. You can sign in now.",
    resendVerification: "Resend verification email",
    signOutClear:
      "Also remove HabitFlow data from this device? It stays in your cloud copy if you synced it. Changes that were not synced will be lost.",
    resendSent: "A new verification email has been sent. Check your inbox.",
    notVerified:
      "Your email isn't verified yet. Use the button below to request a new verification link.",
  },
  ar: {
    eyebrow: "عاداتك، حسابك",
    signinTitle: "أهلًا بعودتك",
    signupTitle: "أنشئ حسابك",
    signinSubtitle: "سجّل الدخول إلى حساب HabitFlow.",
    signupSubtitle: "ابدأ في بناء روتين يناسبك.",
    signin: "تسجيل الدخول",
    signup: "إنشاء حساب",
    name: "الاسم",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    confirm: "تأكيد كلمة المرور",
    forgot: "نسيت كلمة المرور؟",
    back: "العودة إلى HabitFlow",
    continue: "المتابعة إلى HabitFlow",
    signout: "تسجيل الخروج",
    note: "حسابك مؤمّن بواسطة Firebase. فعّل المزامنة السحابية في HabitFlow لمزامنة عاداتك بين أجهزتك.",
    required: "من فضلك أكمل الحقول المطلوبة.",
    mismatch: "كلمتا المرور غير متطابقتين.",
    weak: "يجب ألا تقل كلمة المرور عن 8 أحرف.",
    created: "تم إنشاء الحساب. راجع بريدك لتأكيد عنوانك، ثم سجّل الدخول.",
    signedIn: "تم تسجيل الدخول بنجاح.",
    resetSent: "تم إرسال رسالة استعادة كلمة المرور إلى بريدك.",
    signedOut: "تم تسجيل الخروج.",
    failed: "حدث خطأ. حاول مرة أخرى.",
    already: "أنت مسجل الدخول بالفعل باسم",
    busy: "يرجى الانتظار…",
    newPassword: "كلمة المرور الجديدة",
    confirmNewPassword: "تأكيد كلمة المرور الجديدة",
    savePassword: "حفظ كلمة المرور الجديدة",
    passwordRules: "استخدم 8 خانات على الأقل، تشمل حرفًا ورقمًا.",
    passwordSaved: "تم تحديث كلمة المرور. يمكنك تسجيل الدخول الآن.",
    invalidCredential: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    emailInUse: "هذا البريد مسجّل بالفعل. جرّب تسجيل الدخول.",
    invalidEmail: "صيغة البريد الإلكتروني غير صحيحة.",
    tooMany: "محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.",
    network: "تعذّر الاتصال بالإنترنت. تحقق من الشبكة وحاول مرة أخرى.",
    expiredCode: "هذا الرابط منتهي أو استُخدم من قبل. اطلب رابطًا جديدًا.",
    disabled: "تم إيقاف هذا الحساب.",
    verified: "تم تأكيد بريدك الإلكتروني. يمكنك تسجيل الدخول الآن.",
    resendVerification: "إعادة إرسال رسالة التأكيد",
    signOutClear:
      "هل تريد أيضًا حذف بيانات HabitFlow من هذا الجهاز؟ ستبقى في نسختك السحابية إن كنت قد زامنتها، وستضيع التغييرات غير المزامَنة.",
    resendSent: "تم إرسال رسالة تأكيد جديدة. راجع بريدك الإلكتروني.",
    notVerified:
      "بريدك الإلكتروني غير مؤكّد بعد. استخدم الزر بالأسفل لطلب رسالة تأكيد جديدة.",
  },
};
const t = () => copy[language];
const passwordOk = (password) =>
  password.length >= 8 && /[A-Za-z]/.test(password) && /[0-9]/.test(password);
const continueUrl = () => new URL("./auth.html", location.href).href;
const ERROR_KEYS = {
  "auth/invalid-credential": "invalidCredential",
  "auth/wrong-password": "invalidCredential",
  "auth/user-not-found": "invalidCredential",
  "auth/invalid-login-credentials": "invalidCredential",
  "auth/email-already-in-use": "emailInUse",
  "auth/invalid-email": "invalidEmail",
  "auth/weak-password": "passwordRules",
  "auth/password-does-not-meet-requirements": "passwordRules",
  "auth/too-many-requests": "tooMany",
  "auth/network-request-failed": "network",
  "auth/expired-action-code": "expiredCode",
  "auth/invalid-action-code": "expiredCode",
  "auth/user-disabled": "disabled",
};
// Firebase error messages are English-only and technical; show localized text instead.
const friendlyError = (error) =>
  (error?.code ? t()[ERROR_KEYS[error.code]] : error?.message) || t().failed;

function setMessage(message = "", tone = "") {
  $("authMessage").textContent = message;
  $("authMessage").className = `auth-message ${tone}`.trim();
}
function setMode(mode) {
  state.mode = mode;
  const signup = mode === "signup";
  $("authTitle").textContent = signup ? t().signupTitle : t().signinTitle;
  $("authSubtitle").textContent = signup
    ? t().signupSubtitle
    : t().signinSubtitle;
  $("submitButton").textContent = signup ? t().signup : t().signin;
  $("signInTab").setAttribute("aria-selected", String(!signup));
  $("signUpTab").setAttribute("aria-selected", String(signup));
  $("nameField").hidden = !signup;
  $("confirmField").hidden = !signup;
  $("password").autocomplete = signup ? "new-password" : "current-password";
  $("authLinks").style.display = signup ? "none" : "flex";
  $("resendVerificationButton").hidden = true;
  setMessage();
}
function renderLanguage() {
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  $("authEyebrow").textContent = t().eyebrow;
  $("nameLabel").textContent = t().name;
  $("emailLabel").textContent = t().email;
  $("passwordLabel").textContent = t().password;
  $("confirmLabel").textContent = t().confirm;
  $("forgotButton").textContent = t().forgot;
  $("resendVerificationButton").textContent = t().resendVerification;
  $("backLink").textContent = t().back;
  $("continueButton").textContent = t().continue;
  $("signOutButton").textContent = t().signout;
  $("authNote").textContent = t().note;
  $("signInTab").textContent = t().signin;
  $("signUpTab").textContent = t().signup;
  $("newPasswordLabel").textContent = t().newPassword;
  $("confirmNewPasswordLabel").textContent = t().confirmNewPassword;
  $("savePasswordButton").textContent = t().savePassword;
  setMode(state.mode);
}
function setBusy(busy) {
  state.busy = busy;
  $("submitButton").disabled = busy;
  $("savePasswordButton").disabled = busy;
  $("resendVerificationButton").disabled = busy;
  $("submitButton").textContent = busy
    ? t().busy
    : state.mode === "signup"
      ? t().signup
      : t().signin;
  $("savePasswordButton").textContent = busy ? t().busy : t().savePassword;
}
function showSignedIn(user) {
  $("recoveryPanel").hidden = true;
  $("authForm").hidden = true;
  $("authTabs").hidden = true;
  $("authLinks").hidden = true;
  $("signedInPanel").classList.add("visible");
  $("signedInAs").textContent = `${t().already} ${user.email || user.id}`;
  $("authTitle").textContent = t().signinTitle;
  $("authSubtitle").textContent = t().signedIn;
}
function showSignedOut() {
  $("recoveryPanel").hidden = true;
  $("authForm").hidden = false;
  $("authTabs").hidden = false;
  $("authLinks").hidden = false;
  $("signedInPanel").classList.remove("visible");
}

$("signInTab").addEventListener("click", () => setMode("signin"));
$("signUpTab").addEventListener("click", () => setMode("signup"));
$("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) return;
  const email = $("email").value.trim();
  const password = $("password").value;
  const name = $("displayName").value.trim();
  if (!email || !password) return setMessage(t().required, "error");
  if (state.mode === "signup" && !passwordOk(password))
    return setMessage(t().passwordRules, "error");
  if (state.mode === "signup" && password !== $("confirmPassword").value)
    return setMessage(t().mismatch, "error");
  setBusy(true);
  try {
    if (state.mode === "signup") {
      const credential = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );
      if (name) await updateProfile(credential.user, { displayName: name });
      await sendEmailVerification(credential.user, { url: continueUrl() });
      await signOut(auth);
      showSignedOut();
      setMessage(t().created, "success");
    } else {
      const credential = await signInWithEmailAndPassword(
        auth,
        email,
        password,
      );
      await reload(credential.user);
      if (!credential.user.emailVerified) {
        await signOut(auth);
        $("resendVerificationButton").hidden = false;
        throw new Error(t().notVerified);
      }
      showSignedIn(credential.user);
      setMessage(t().signedIn, "success");
    }
  } catch (error) {
    console.error("HabitFlow auth error:", error);
    // Never leave a half-finished (unverified) session behind.
    if (auth.currentUser && !auth.currentUser.emailVerified)
      await signOut(auth).catch(() => {});
    setMessage(friendlyError(error), "error");
  } finally {
    setBusy(false);
  }
});
$("resendVerificationButton").addEventListener("click", async () => {
  if (state.busy) return;

  const email = $("email").value.trim();
  const password = $("password").value;

  if (!email || !password) {
    return setMessage(t().required, "error");
  }

  setBusy(true);

  try {
    // Authenticate again to obtain a valid Firebase User object.
    const credential = await signInWithEmailAndPassword(auth, email, password);

    await reload(credential.user);

    // The user may have verified the email in another tab.
    if (credential.user.emailVerified) {
      $("resendVerificationButton").hidden = true;
      await signOut(auth);
      setMessage(t().verified, "success");
      return;
    }

    await sendEmailVerification(credential.user, {
      url: continueUrl(),
    });

    await signOut(auth);

    setMessage(t().resendSent, "success");
  } catch (error) {
    console.error("HabitFlow verification resend error:", error);

    if (auth.currentUser && !auth.currentUser.emailVerified) {
      await signOut(auth).catch(() => {});
    }

    setMessage(friendlyError(error), "error");
  } finally {
    setBusy(false);
  }
});
$("recoveryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) return;
  const password = $("newPassword").value;
  const confirmation = $("confirmNewPassword").value;
  if (password !== confirmation) return setMessage(t().mismatch, "error");
  if (!passwordOk(password)) return setMessage(t().passwordRules, "error");
  setBusy(true);
  try {
    const params = new URLSearchParams(location.search);
    const code = params.get("oobCode");
    if (!code) throw new Error(t().failed);
    await confirmPasswordReset(auth, code, password);
    state.recovering = false;
    history.replaceState({}, "", location.pathname);
    $("newPassword").value = "";
    $("confirmNewPassword").value = "";
    showSignedOut();
    setMode("signin");
    setMessage(t().passwordSaved, "success");
    watchSession();
  } catch (error) {
    console.error("HabitFlow password recovery error:", error);
    if (
      error?.code === "auth/expired-action-code" ||
      error?.code === "auth/invalid-action-code"
    ) {
      // A dead link cannot be retried: return to the normal sign-in screen.
      history.replaceState({}, "", location.pathname);
      showSignedOut();
      setMode("signin");
      watchSession();
    }
    setMessage(friendlyError(error), "error");
  } finally {
    setBusy(false);
  }
});

function showRecoveryForm() {
  state.recovering = true;
  $("authForm").hidden = true;
  $("authTabs").hidden = true;
  $("authLinks").hidden = true;
  $("signedInPanel").classList.remove("visible");
  $("recoveryPanel").hidden = false;
  $("authTitle").textContent = t().newPassword;
  $("authSubtitle").textContent = t().passwordRules;
  setMessage();
}

$("forgotButton").addEventListener("click", async () => {
  const email = $("email").value.trim();
  if (!email) return setMessage(t().required, "error");
  try {
    await sendPasswordResetEmail(auth, email, { url: continueUrl() });
    setMessage(t().resetSent, "success");
  } catch (error) {
    setMessage(friendlyError(error), "error");
  }
});
$("signOutButton").addEventListener("click", async () => {
  const user = auth.currentUser;
  console.log("Logout diagnostic:", {
  hasUser: Boolean(user?.uid),
  hasPushToken: Boolean(
    localStorage.getItem("habitflow_push_token")
  ),
});
  // On a device linked to a cloud account, offer to wipe the local habit data (shared-device privacy).
  const linked =
    Boolean(localStorage.getItem("habitflow_cloud_owner")) &&
    loadData().habits.length > 0;
  const clearLocal = linked && confirm(t().signOutClear);
  // Stop push reminders for this account on this device while the ID token is still available.
  const saved = await unregisterDevice(user, { defer: true });

 if (!saved) {
  return setMessage(
    "Could not save the pending reminder unregister request.",
    "error",
  );
}

try {
  await signOut(auth);
} catch (error) {
  return setMessage(friendlyError(error), "error");
}
  if (clearLocal) {
    clearData();
    clearSyncConfig();
    localStorage.removeItem("habitflow_cloud_owner");
  }
  showSignedOut();
  setMode("signin");
  setMessage(t().signedOut, "success");
});
$("continueButton").addEventListener("click", () => {
  location.href = "./index.html";
});
renderLanguage();

async function handleVerifyEmail(code) {
  try {
    await applyActionCode(auth, code);
    setMessage(t().verified, "success");
  } catch (error) {
    console.error("HabitFlow email verification error:", error);
    setMessage(friendlyError(error), "error");
  } finally {
    history.replaceState({}, "", location.pathname);
  }
}

// Only verified accounts are treated as signed in (unverified sessions are closed right away).
function watchSession() {
  return onAuthStateChanged(auth, (user) =>
    user?.emailVerified ? showSignedIn(user) : showSignedOut(),
  );
}
const actionParams = new URLSearchParams(location.search);
const actionMode = actionParams.get("mode");
const actionCode = actionParams.get("oobCode");
if (actionMode === "resetPassword" && actionCode) {
  showRecoveryForm();
} else {
  watchSession();
  if (actionMode === "verifyEmail" && actionCode) handleVerifyEmail(actionCode);
}
