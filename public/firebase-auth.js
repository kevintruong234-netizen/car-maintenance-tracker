import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut
} from "firebase/auth";
import { auth } from "./firebase.js";

const ALLOWED_OWNER_EMAIL = "kevintruong234@gmail.com";

const provider = new GoogleAuthProvider();
provider.setCustomParameters({
  prompt: "select_account"
});

function setAuthStatusMessage(message, isError = false) {
  const statusEl = document.getElementById("auth-gate-status");
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.dataset.state = isError ? "error" : "info";
}

function setAppLocked(isLocked, user = null) {
  const gate = document.getElementById("auth-gate");
  const protectedRegions = document.querySelectorAll("[data-auth-protected]");

  if (gate) {
    gate.hidden = !isLocked;
  }

  protectedRegions.forEach((el) => {
    if (isLocked) {
      el.setAttribute("hidden", "");
      el.setAttribute("inert", "");
    } else {
      el.removeAttribute("hidden");
      el.removeAttribute("inert");
    }
  });

  const emailBadge = document.getElementById("auth-user-email");
  if (emailBadge) {
    emailBadge.textContent = user?.email || "";
  }
}

async function handleSignInClick() {
  const btn = document.getElementById("btn-google-signin");
  if (btn) btn.disabled = true;
  setAuthStatusMessage("Opening Google Sign-In…", false);

  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    const code = error?.code || "";
    if (code === "auth/popup-blocked") {
      setAuthStatusMessage("Redirecting to Google Sign-In…", false);
      await signInWithRedirect(auth, provider);
      return;
    }
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
      setAuthStatusMessage("Sign-in cancelled. Sign in with kevintruong234@gmail.com to continue.", false);
    } else if (code === "auth/unauthorized-domain") {
      setAuthStatusMessage(
        `Domain "${window.location.hostname}" is not yet in Firebase Authorized Domains.`,
        true
      );
    } else {
      setAuthStatusMessage(error?.message || "Google Sign-In failed. Please try again.", true);
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleSignOutClick() {
  setAuthStatusMessage("Signed out. Sign in with Google to unlock GarageLog.", false);
  await signOut(auth);
}

function initFirebaseAuthGate() {
  const signInBtn = document.getElementById("btn-google-signin");
  if (signInBtn) {
    signInBtn.addEventListener("click", handleSignInClick);
  }

  const signOutBtn = document.getElementById("btn-auth-signout");
  if (signOutBtn) {
    signOutBtn.addEventListener("click", handleSignOutClick);
  }

  document.querySelectorAll('[data-mobile-action="sign-out"]').forEach((btn) => {
    btn.addEventListener("click", handleSignOutClick);
  });

  // Handle redirect result if mobile fallback occurred
  getRedirectResult(auth).catch((err) => {
    if (err?.message) {
      setAuthStatusMessage(err.message, true);
    }
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      setAppLocked(true, null);
      if (window.GarageLogApp && typeof window.GarageLogApp.onOwnerSignedOut === "function") {
        window.GarageLogApp.onOwnerSignedOut();
      }
      return;
    }

    const email = String(user.email || "").trim().toLowerCase();
    if (email !== ALLOWED_OWNER_EMAIL || user.emailVerified === false) {
      const rejectedEmail = user.email || "Unknown account";
      await signOut(auth);
      setAppLocked(true, null);
      setAuthStatusMessage(
        `Access Denied: "${rejectedEmail}" is not authorized. This app is locked exclusively to ${ALLOWED_OWNER_EMAIL}.`,
        true
      );
      return;
    }

    // Authorized owner! Unlock app and load data
    setAuthStatusMessage(`Signed in as ${user.email}`, false);
    setAppLocked(false, user);
    if (window.GarageLogApp && typeof window.GarageLogApp.onOwnerAuthenticated === "function") {
      window.GarageLogApp.onOwnerAuthenticated(user);
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initFirebaseAuthGate);
} else {
  initFirebaseAuthGate();
}
