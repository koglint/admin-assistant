import {
  auth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from './firebase.js';

const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const content = document.getElementById('content');

const form = document.getElementById('upload-form');
const fileInput = document.getElementById('xls-file');
const statusDiv = document.getElementById('upload-status');

const BACKEND_URL = "https://admin-assistant-backend.onrender.com/upload";

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
  signOut(auth);
};

onAuthStateChanged(auth, (user) => {
  if (user) {
    userInfo.textContent = "";
    loginBtn.classList.add("hidden");
    logoutBtn.classList.remove("hidden");
    logoutBtn.classList.add("inline-block");
    content.classList.remove("hidden");
    content.classList.add("visible");
  } else {
    userInfo.textContent = "";
    loginBtn.classList.remove("hidden");
    loginBtn.classList.add("inline-block");
    logoutBtn.classList.add("hidden");
    content.classList.add("hidden");
  }
});

if (form && fileInput && statusDiv) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = fileInput.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('uploadMode', getSelectedUploadMode());

    statusDiv.textContent = "Uploading...";

    try {
      const response = await fetch(BACKEND_URL, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (response.ok && data.status === "success") {
        statusDiv.textContent = buildUploadStatus(data);
      } else {
        statusDiv.textContent = data.message || "Upload failed. Check file format.";
      }
    } catch (err) {
      console.error(err);
      statusDiv.textContent = "Error uploading file.";
    }
  });
}

function getSelectedUploadMode() {
  return form?.querySelector('input[name="upload-mode"]:checked')?.value || "late_arrivals";
}

function buildUploadStatus(data) {
  const confirmationOnly = data.uploadMode === "attendance_confirmation" || data.lateProcessingSkipped;
  const reportDate = data.reportDate ? `Processed report for ${data.reportDate}. ` : "Processed upload. ";
  const mode = confirmationOnly
    ? "Attendance confirmation only: late arrivals were not recorded and new detentions were not assigned. "
    : "Morning late-arrival upload: late arrivals and detention assignment were processed. ";
  const pendingDates = Array.isArray(data.pendingDetentionCheckDates)
    ? data.pendingDetentionCheckDates
        .filter((item) => item && item.date && item.count)
        .map((item) => `${item.date} (${item.count} check${item.count === 1 ? "" : "s"})`)
    : [];
  const latestObserved = data.latestObservedTime
    ? `Latest time found in the report: ${data.latestObservedTime}. `
    : "";
  const coverage = data.coversFullDay
    ? "This file appears to include full-day absence coverage. "
    : "This file does not yet appear to show full-day absence coverage, so some detention absence checks may stay pending until a confirmation upload includes that date. ";
  const checksCompleted = data.detentionChecksCompleted
    ? `${data.detentionChecksCompleted} pending detention attendance check(s) were completed. `
    : "";
  const missedConfirmed = data.missedDetentionsConfirmed
    ? `${data.missedDetentionsConfirmed} missed detention(s) were confirmed while the student was present at school. `
    : "";
  const notCounted = data.detentionAbsencesNotCounted
    ? `${data.detentionAbsencesNotCounted} missed detention absence(s) were not counted because an absence row was recorded. `
    : "";
  const rolledForward = data.detentionsRolledForward
    ? `${data.detentionsRolledForward} detention(s) were rolled forward. `
    : "";
  const checksWaiting = data.pendingDetentionChecks
    ? `${data.pendingDetentionChecks} detention attendance check(s) are still waiting for fuller attendance data for ${pendingDates.length ? pendingDates.join(", ") : "that date"}.`
    : "";

  return `${reportDate}${mode}${data.added} late arrival(s) recorded. ${data.detentionsAssigned || 0} detention(s) assigned. ${checksCompleted}${missedConfirmed}${notCounted}${rolledForward}${latestObserved}${coverage}${checksWaiting}`.trim();
}
