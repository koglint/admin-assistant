import {
  auth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from './firebase.js';

const BACKEND_BASE_URL = "https://admin-assistant-backend.onrender.com";
const ADMIN_PURGE_URL = `${BACKEND_BASE_URL}/admin/purge`;
const ADMIN_STUDENT_PURGE_URL = `${BACKEND_BASE_URL}/admin/student-purge`;
const ADMIN_STUDENT_EXCEPTION_URL = `${BACKEND_BASE_URL}/admin/student-exception`;
const ADMIN_AUTHORIZE_URL = "https://admin-assistant-backend.onrender.com/admin/authorize";
const ALLOWED_ADMIN_USERNAMES = [
  "troy.koglin1",
  "gordon.nolan2",
  "david.boscoscuro",
  "peter.hales",
  "janine.neden",
  "jennifer.lynne.lawrence",
  "carly.johnston7",
  "kylie.cutajar4",
  "louise.oneill6",
  "david.baldwin12",
  "nathan.ralstonbryce"
];
const ALLOWED_ADMIN_DOMAINS = [
  "det.nsw.edu.au",
  "education.nsw.gov.au"
];

const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const content = document.getElementById('content');
const unlockBtn = document.getElementById('unlock-btn');
const passwordInput = document.getElementById('admin-password');
const passwordStatus = document.getElementById('password-status');
const adminPanel = document.getElementById('admin-panel');
const exceptionBtn = document.getElementById('exception-btn');
const exceptionConfirmation = document.getElementById('exception-confirmation');
const exceptionStudentIdInput = document.getElementById('exception-student-id-input');
const exceptionConfirmInput = document.getElementById('exception-confirm-input');
const exceptionReasonInput = document.getElementById('exception-reason-input');
const confirmExceptionBtn = document.getElementById('confirm-exception-btn');
const cancelExceptionBtn = document.getElementById('cancel-exception-btn');
const studentPurgeBtn = document.getElementById('student-purge-btn');
const studentPurgeConfirmation = document.getElementById('student-purge-confirmation');
const studentPurgeIdInput = document.getElementById('student-purge-id-input');
const studentPurgeConfirmInput = document.getElementById('student-purge-confirm-input');
const confirmStudentPurgeBtn = document.getElementById('confirm-student-purge-btn');
const cancelStudentPurgeBtn = document.getElementById('cancel-student-purge-btn');
const purgeBtn = document.getElementById('purge-btn');
const purgeAvailability = document.getElementById('purge-availability');
const purgeConfirmation = document.getElementById('purge-confirmation');
const deleteConfirmInput = document.getElementById('delete-confirm-input');
const confirmPurgeBtn = document.getElementById('confirm-purge-btn');
const cancelPurgeBtn = document.getElementById('cancel-purge-btn');
const adminActionStatus = document.getElementById('admin-action-status');

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
  clearActionStatus();
  hideStudentActionPanels();
  purgeConfirmation.classList.remove("hidden");
  deleteConfirmInput.focus();
});

exceptionBtn.addEventListener("click", () => {
  if (!adminUnlocked) return;

  clearActionStatus();
  hideStudentActionPanels();
  exceptionStudentIdInput.value = "";
  exceptionConfirmInput.value = "";
  exceptionReasonInput.value = "";
  exceptionConfirmation.classList.remove("hidden");
  exceptionStudentIdInput.focus();
});

studentPurgeBtn.addEventListener("click", () => {
  if (!adminUnlocked) return;

  clearActionStatus();
  hideStudentActionPanels();
  studentPurgeIdInput.value = "";
  studentPurgeConfirmInput.value = "";
  studentPurgeConfirmation.classList.remove("hidden");
  studentPurgeIdInput.focus();
});

cancelExceptionBtn.addEventListener("click", () => {
  exceptionConfirmation.classList.add("hidden");
  exceptionStudentIdInput.value = "";
  exceptionConfirmInput.value = "";
  exceptionReasonInput.value = "";
  setActionStatus("Exception action cancelled.", false);
});

cancelStudentPurgeBtn.addEventListener("click", () => {
  studentPurgeConfirmation.classList.add("hidden");
  studentPurgeIdInput.value = "";
  studentPurgeConfirmInput.value = "";
  setActionStatus("Student purge cancelled.", false);
});

cancelPurgeBtn.addEventListener("click", () => {
  purgeConfirmation.classList.add("hidden");
  deleteConfirmInput.value = "";
  setActionStatus("Full data purge cancelled.", false);
});

confirmExceptionBtn.addEventListener("click", async () => {
  const studentId = normalizeStudentId(exceptionStudentIdInput.value);
  const confirmation = normalizeStudentId(exceptionConfirmInput.value);

  if (!studentId) {
    setActionStatus("Enter the student ID to add to the exception list.", true);
    return;
  }

  if (confirmation !== studentId) {
    setActionStatus("Type the same student ID again to confirm.", true);
    return;
  }

  await runProtectedStudentAction({
    url: ADMIN_STUDENT_EXCEPTION_URL,
    payload: {
      studentId,
      confirmation,
      reason: exceptionReasonInput.value
    },
    buttons: [exceptionBtn, confirmExceptionBtn, cancelExceptionBtn],
    pendingMessage: `Adding ${studentId} to the exception list...`,
    successMessage: (data) => {
      const summary = formatCollectionSummary(data);
      return `Exception added for ${studentId}. Removed ${data.deleted || 0} existing record(s). ${summary}`;
    },
    onSuccess: () => {
      exceptionConfirmation.classList.add("hidden");
      exceptionStudentIdInput.value = "";
      exceptionConfirmInput.value = "";
      exceptionReasonInput.value = "";
    }
  });
});

confirmStudentPurgeBtn.addEventListener("click", async () => {
  const studentId = normalizeStudentId(studentPurgeIdInput.value);
  const confirmation = normalizeStudentId(studentPurgeConfirmInput.value);

  if (!studentId) {
    setActionStatus("Enter the student ID to purge.", true);
    return;
  }

  if (confirmation !== studentId) {
    setActionStatus("Type the same student ID again to confirm.", true);
    return;
  }

  const confirmed = window.confirm(`Delete Firestore records for student ${studentId}?`);
  if (!confirmed) return;

  await runProtectedStudentAction({
    url: ADMIN_STUDENT_PURGE_URL,
    payload: {
      studentId,
      confirmation
    },
    buttons: [studentPurgeBtn, confirmStudentPurgeBtn, cancelStudentPurgeBtn],
    pendingMessage: `Purging records for student ${studentId}...`,
    successMessage: (data) => {
      const summary = formatCollectionSummary(data);
      return `Student purge complete for ${studentId}. Deleted ${data.deleted || 0} record(s). ${summary}`;
    },
    onSuccess: () => {
      studentPurgeConfirmation.classList.add("hidden");
      studentPurgeIdInput.value = "";
      studentPurgeConfirmInput.value = "";
    }
  });
});

confirmPurgeBtn.addEventListener("click", async () => {
  if (!adminUnlocked || !auth.currentUser) return;

  if (deleteConfirmInput.value !== "DELETE") {
    setActionStatus("Type DELETE exactly to confirm.", true);
    return;
  }

  if (!passwordInput.value) {
    setActionStatus("Enter the admin password before purging.", true);
    return;
  }

  purgeBtn.disabled = true;
  confirmPurgeBtn.disabled = true;
  cancelPurgeBtn.disabled = true;
  setActionStatus("Requesting full data purge from the backend...", false);

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
      setActionStatus(data.message || "Full data purge failed.", true);
      return;
    }

    const collectionSummary = formatCollectionSummary(data);
    setActionStatus(`Full data purge complete. Deleted ${data.deleted} document(s). ${collectionSummary}`, false);
    purgeConfirmation.classList.add("hidden");
    deleteConfirmInput.value = "";
    passwordInput.value = "";
    adminUnlocked = false;
    adminPanel.classList.add("hidden");
    setPasswordStatus("Admin controls locked again. Re-enter the backend password for another admin action.", false);
  } catch (err) {
    console.error(err);
    setActionStatus("Could not contact the backend purge endpoint.", true);
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
  exceptionStudentIdInput.value = "";
  exceptionConfirmInput.value = "";
  exceptionReasonInput.value = "";
  studentPurgeIdInput.value = "";
  studentPurgeConfirmInput.value = "";
  adminPanel.classList.add("hidden");
  exceptionConfirmation.classList.add("hidden");
  studentPurgeConfirmation.classList.add("hidden");
  purgeConfirmation.classList.add("hidden");
  exceptionBtn.disabled = true;
  studentPurgeBtn.disabled = true;
  purgeBtn.disabled = true;
  confirmExceptionBtn.disabled = false;
  cancelExceptionBtn.disabled = false;
  confirmStudentPurgeBtn.disabled = false;
  cancelStudentPurgeBtn.disabled = false;
  confirmPurgeBtn.disabled = false;
  cancelPurgeBtn.disabled = false;
  clearActionStatus();
  updatePurgeAvailability();
  setPasswordStatus("", false);
}

function updatePurgeAvailability(purgeEnabled = null) {
  if (!auth.currentUser) {
    purgeAvailability.textContent = "Sign in first.";
    purgeAvailability.classList.remove("success-text");
    purgeAvailability.classList.add("error-text");
    purgeBtn.disabled = true;
    exceptionBtn.disabled = true;
    studentPurgeBtn.disabled = true;
    return;
  }

  if (!isAllowedAdminEmail(currentUserEmail)) {
    purgeAvailability.textContent = "This signed-in email is not approved for admin purge.";
    purgeAvailability.classList.remove("success-text");
    purgeAvailability.classList.add("error-text");
    purgeBtn.disabled = true;
    exceptionBtn.disabled = true;
    studentPurgeBtn.disabled = true;
    return;
  }

  if (purgeEnabled === false) {
    purgeAvailability.textContent = "Purge is currently disabled on the backend.";
    purgeAvailability.classList.remove("success-text");
    purgeAvailability.classList.add("error-text");
    purgeBtn.disabled = true;
    exceptionBtn.disabled = !adminUnlocked;
    studentPurgeBtn.disabled = !adminUnlocked;
    return;
  }

  purgeAvailability.textContent = "Purge is backend-protected and only available after approval on the server.";
  purgeAvailability.classList.remove("error-text");
  purgeAvailability.classList.add("success-text");
  purgeBtn.disabled = !adminUnlocked;
  exceptionBtn.disabled = !adminUnlocked;
  studentPurgeBtn.disabled = !adminUnlocked;
}

function isAllowedAdminEmail(email) {
  const [username, domain] = (email || "").toLowerCase().split("@");
  return ALLOWED_ADMIN_USERNAMES.includes(username) && ALLOWED_ADMIN_DOMAINS.includes(domain);
}

function setPasswordStatus(message, isError) {
  passwordStatus.textContent = message;
  passwordStatus.classList.toggle("error-text", isError);
  passwordStatus.classList.toggle("success-text", message !== "" && !isError);
}

function setActionStatus(message, isError) {
  adminActionStatus.textContent = message;
  adminActionStatus.classList.toggle("error-text", isError);
  adminActionStatus.classList.toggle("success-text", message !== "" && !isError);
}

function clearActionStatus() {
  setActionStatus("", false);
}

function hideStudentActionPanels() {
  exceptionConfirmation.classList.add("hidden");
  studentPurgeConfirmation.classList.add("hidden");
  purgeConfirmation.classList.add("hidden");
}

async function runProtectedStudentAction({
  url,
  payload,
  buttons,
  pendingMessage,
  successMessage,
  onSuccess
}) {
  if (!adminUnlocked || !auth.currentUser) return;

  if (!passwordInput.value) {
    setActionStatus("Enter the admin password before running this action.", true);
    return;
  }

  buttons.forEach(button => {
    button.disabled = true;
  });
  setActionStatus(pendingMessage, false);

  try {
    const idToken = await auth.currentUser.getIdToken(true);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`
      },
      body: JSON.stringify({
        password: passwordInput.value,
        ...payload
      })
    });

    const data = await response.json();
    if (!response.ok || data.status !== "success") {
      setActionStatus(data.message || "Admin action failed.", true);
      return;
    }

    setActionStatus(successMessage(data), false);
    if (typeof onSuccess === "function") onSuccess(data);
  } catch (err) {
    console.error(err);
    setActionStatus("Could not contact the backend admin endpoint.", true);
  } finally {
    buttons.forEach(button => {
      button.disabled = false;
    });
  }
}

function normalizeStudentId(value) {
  return String(value || "").trim();
}

function formatCollectionSummary(data) {
  if (!data.deletedByCollection) {
    return `${data.deleted || 0} document(s) affected.`;
  }

  return Object.entries(data.deletedByCollection)
    .map(([collectionName, count]) => `${collectionName}: ${count}`)
    .join(", ");
}
