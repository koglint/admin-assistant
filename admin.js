import {
  auth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from './firebase.js';

const ADMIN_PURGE_URL = "https://admin-assistant-backend.onrender.com/admin/purge";
const ADMIN_AUTHORIZE_URL = "https://admin-assistant-backend.onrender.com/admin/authorize";
const ALLOWED_ADMIN_EMAILS = [
  "troy.koglin1@det.nsw.edu.au",
  "troy.koglin1@education.nsw.gov.au"
];

const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const content = document.getElementById('content');
const unlockBtn = document.getElementById('unlock-btn');
const passwordInput = document.getElementById('admin-password');
const passwordStatus = document.getElementById('password-status');
const adminPanel = document.getElementById('admin-panel');
const purgeBtn = document.getElementById('purge-btn');
const purgeAvailability = document.getElementById('purge-availability');
const purgeConfirmation = document.getElementById('purge-confirmation');
const deleteConfirmInput = document.getElementById('delete-confirm-input');
const confirmPurgeBtn = document.getElementById('confirm-purge-btn');
const cancelPurgeBtn = document.getElementById('cancel-purge-btn');
const purgeStatus = document.getElementById('purge-status');

let adminUnlocked = false;
let currentUserEmail = "";

loginBtn.onclick = async () => {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    alert("Login failed");
    console.error(err);
  }
};

logoutBtn.onclick = () => {
  adminUnlocked = false;
  currentUserEmail = "";
  resetAdminUi();
  signOut(auth);
};

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUserEmail = (user.email || "").toLowerCase();
    userInfo.textContent = `Signed in as: ${user.displayName} (${user.email})`;
    loginBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";
    content.style.display = "block";
    resetAdminUi();
  } else {
    currentUserEmail = "";
    userInfo.textContent = "";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    content.style.display = "none";
    resetAdminUi();
  }
});

unlockBtn.addEventListener("click", async () => {
  if (!auth.currentUser) {
    setPasswordStatus("You must be signed in before using admin controls.", true);
    return;
  }

  if (!isAllowedAdminEmail(currentUserEmail)) {
    adminUnlocked = false;
    adminPanel.classList.add("hidden");
    setPasswordStatus("This signed-in account is not allowed to use admin controls.", true);
    return;
  }

  if (!passwordInput.value) {
    setPasswordStatus("Enter the backend admin password.", true);
    return;
  }

  unlockBtn.disabled = true;
  setPasswordStatus("Checking admin access with the backend...", false);

  try {
    const idToken = await auth.currentUser.getIdToken(true);
    const response = await fetch(ADMIN_AUTHORIZE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`
      },
      body: JSON.stringify({
        password: passwordInput.value
      })
    });

    const data = await response.json();
    if (!response.ok || data.status !== "success") {
      adminUnlocked = false;
      adminPanel.classList.add("hidden");
      setPasswordStatus(data.message || "Admin access was denied.", true);
      return;
    }

    adminUnlocked = true;
    adminPanel.classList.remove("hidden");
    updatePurgeAvailability(Boolean(data.purgeEnabled));
    setPasswordStatus("Admin controls unlocked for this approved account.", false);
  } catch (err) {
    console.error(err);
    adminUnlocked = false;
    adminPanel.classList.add("hidden");
    setPasswordStatus("Could not verify admin access with the backend.", true);
  } finally {
    unlockBtn.disabled = false;
  }
});

passwordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    unlockBtn.click();
  }
});

purgeBtn.addEventListener("click", () => {
  if (!adminUnlocked) return;

  const confirmed = window.confirm("Are you sure? This will delete all student data.");
  if (!confirmed) return;

  deleteConfirmInput.value = "";
  purgeStatus.textContent = "";
  purgeStatus.classList.remove("success-text", "error-text");
  purgeConfirmation.classList.remove("hidden");
  deleteConfirmInput.focus();
});

cancelPurgeBtn.addEventListener("click", () => {
  purgeConfirmation.classList.add("hidden");
  deleteConfirmInput.value = "";
  setPurgeStatus("Purge cancelled.", false);
});

confirmPurgeBtn.addEventListener("click", async () => {
  if (!adminUnlocked || !auth.currentUser) return;

  if (deleteConfirmInput.value !== "DELETE") {
    setPurgeStatus("Type DELETE exactly to confirm.", true);
    return;
  }

  if (!passwordInput.value) {
    setPurgeStatus("Enter the admin password before purging.", true);
    return;
  }

  purgeBtn.disabled = true;
  confirmPurgeBtn.disabled = true;
  cancelPurgeBtn.disabled = true;
  setPurgeStatus("Requesting secure purge from the backend...", false);

  try {
    const idToken = await auth.currentUser.getIdToken(true);
    const response = await fetch(ADMIN_PURGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`
      },
      body: JSON.stringify({
        password: passwordInput.value,
        confirmation: deleteConfirmInput.value
      })
    });

    const data = await response.json();
    if (!response.ok || data.status !== "success") {
      setPurgeStatus(data.message || "Secure purge failed.", true);
      return;
    }

    setPurgeStatus(`Purge complete. Deleted ${data.deleted} student record(s).`, false);
    purgeConfirmation.classList.add("hidden");
    deleteConfirmInput.value = "";
    passwordInput.value = "";
    adminUnlocked = false;
    adminPanel.classList.add("hidden");
    setPasswordStatus("Admin controls locked again. Re-enter the backend password for another admin action.", false);
  } catch (err) {
    console.error(err);
    setPurgeStatus("Could not contact the backend purge endpoint.", true);
  } finally {
    purgeBtn.disabled = false;
    confirmPurgeBtn.disabled = false;
    cancelPurgeBtn.disabled = false;
  }
});

function resetAdminUi() {
  adminUnlocked = false;
  passwordInput.value = "";
  deleteConfirmInput.value = "";
  adminPanel.classList.add("hidden");
  purgeConfirmation.classList.add("hidden");
  purgeBtn.disabled = true;
  confirmPurgeBtn.disabled = false;
  cancelPurgeBtn.disabled = false;
  purgeStatus.textContent = "";
  purgeStatus.classList.remove("error-text", "success-text");
  updatePurgeAvailability();
  setPasswordStatus("", false);
}

function updatePurgeAvailability(purgeEnabled = null) {
  if (!auth.currentUser) {
    purgeAvailability.textContent = "Sign in first.";
    purgeAvailability.classList.remove("success-text");
    purgeAvailability.classList.add("error-text");
    purgeBtn.disabled = true;
    return;
  }

  if (!isAllowedAdminEmail(currentUserEmail)) {
    purgeAvailability.textContent = "This signed-in email is not approved for admin purge.";
    purgeAvailability.classList.remove("success-text");
    purgeAvailability.classList.add("error-text");
    purgeBtn.disabled = true;
    return;
  }

  if (purgeEnabled === false) {
    purgeAvailability.textContent = "Purge is currently disabled on the backend.";
    purgeAvailability.classList.remove("success-text");
    purgeAvailability.classList.add("error-text");
    purgeBtn.disabled = true;
    return;
  }

  purgeAvailability.textContent = "Purge is backend-protected and only available after approval on the server.";
  purgeAvailability.classList.remove("error-text");
  purgeAvailability.classList.add("success-text");
  purgeBtn.disabled = !adminUnlocked;
}

function isAllowedAdminEmail(email) {
  return ALLOWED_ADMIN_EMAILS.includes((email || "").toLowerCase());
}

function setPasswordStatus(message, isError) {
  passwordStatus.textContent = message;
  passwordStatus.classList.toggle("error-text", isError);
  passwordStatus.classList.toggle("success-text", message !== "" && !isError);
}

function setPurgeStatus(message, isError) {
  purgeStatus.textContent = message;
  purgeStatus.classList.toggle("error-text", isError);
  purgeStatus.classList.toggle("success-text", message !== "" && !isError);
}
