import { supabase } from "./supabase-client.js";

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
    note: "Your account is secured by Supabase. Your habit data remains on this device for now; account-based cloud sync will be added in the next stage.",
    required: "Please complete all required fields.",
    mismatch: "Passwords do not match.",
    weak: "Password must contain at least 8 characters.",
    created:
      "Account created. Check your email to confirm your address, then sign in.",
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
    passwordSaved: "Your password has been updated.",
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
    note: "حسابك مؤمّن بواسطة Supabase. بيانات عاداتك ما زالت محفوظة على هذا الجهاز حاليًا؛ سنضيف المزامنة المرتبطة بالحساب في المرحلة التالية.",
    required: "من فضلك أكمل الحقول المطلوبة.",
    mismatch: "كلمتا المرور غير متطابقتين.",
    weak: "يجب ألا تقل كلمة المرور عن 8 أحرف.",
    created: "تم إنشاء الحساب. راجع بريدك لتأكيده، ثم سجّل الدخول.",
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
    passwordSaved: "تم تحديث كلمة المرور بنجاح.",
  },
};
const t = () => copy[language];

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
  if (
    password.length < 8 ||
    !/[A-Za-z]/.test(password) ||
    !/[0-9]/.test(password)
  )
    return setMessage(t().passwordRules, "error");
  if (state.mode === "signup" && password !== $("confirmPassword").value)
    return setMessage(t().mismatch, "error");
  setBusy(true);
  try {
    if (state.mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: name },
          emailRedirectTo: new URL("./auth.html", location.href).href,
        },
      });
      if (error) throw error;
      if (data.session) showSignedIn(data.user);
      setMessage(t().created, "success");
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      showSignedIn(data.user);
      setMessage(t().signedIn, "success");
    }
  } catch (error) {
    console.error("HabitFlow auth error:", error);
    setMessage(error.message || t().failed, "error");
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
  if (
    password.length < 8 ||
    !/[A-Za-z]/.test(password) ||
    !/[0-9]/.test(password)
  )
    return setMessage(t().passwordRules, "error");
  setBusy(true);
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    state.recovering = false;
    $("recoveryPanel").hidden = true;
    const { data } = await supabase.auth.getUser();
    if (data.user) showSignedIn(data.user);
    setMessage(t().passwordSaved, "success");
    $("newPassword").value = "";
    $("confirmNewPassword").value = "";
  } catch (error) {
    console.error("HabitFlow password recovery error:", error);
    setMessage(error.message || t().failed, "error");
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
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: new URL("./auth.html", location.href).href,
    });
    if (error) throw error;
    setMessage(t().resetSent, "success");
  } catch (error) {
    setMessage(error.message || t().failed, "error");
  }
});
$("signOutButton").addEventListener("click", async () => {
  const { error } = await supabase.auth.signOut();
  if (error) return setMessage(error.message || t().failed, "error");
  showSignedOut();
  setMode("signin");
  setMessage(t().signedOut, "success");
});
$("continueButton").addEventListener("click", () => {
  location.href = "./index.html";
});
supabase.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY") {
    showRecoveryForm();
    return;
  }
  if (state.recovering) return;
  if (session?.user) showSignedIn(session.user);
  else showSignedOut();
});
renderLanguage();
supabase.auth.getSession().then(({ data, error }) => {
  if (error) setMessage(error.message, "error");
  // A recovery link creates a valid session too; do not hide the new-password form.
  if (!state.recovering && data.session?.user) showSignedIn(data.session.user);
  else if (!state.recovering && !data.session) showSignedOut();
});
