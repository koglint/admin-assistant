import {
  auth,
  db,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from './firebase.js';

import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const content = document.getElementById('content');

const tableBody = document.getElementById("truancy-body");
const tableHeaders = document.querySelectorAll("#truancy-table th");
const searchInput = document.getElementById("truancy-search");
const sortButtons = document.querySelectorAll(".sort-btn");
const yearFilterButtons = document.querySelectorAll(".year-filter-btn");
const tableStats = document.getElementById("table-stats");
const toggleEscalatedBtn = document.getElementById("toggle-escalated-btn");
const toggleResolvedBtn = document.getElementById("toggle-resolved-btn");

const form = document.getElementById('upload-form');
const fileInput = document.getElementById('xls-file');
const statusDiv = document.getElementById('upload-status');

const BACKEND_URL = "https://admin-assistant-backend.onrender.com/upload";
const YEAR_FILTER_OPTIONS = ["7", "8", "9", "10", "11", "12", "SRC"];

let currentSortKey = "yearGroup";
let sortAsc = true;
let studentDataCache = [];
let filteredStudentData = [];
let showEscalated = false;
let hideResolved = false;
let yearFilterIsCustom = false;

const expandedStudentIds = new Set();
const selectedYearFilters = new Set(YEAR_FILTER_OPTIONS);

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

    if (tableBody) {
      updateSortButtons();
      updateYearFilterButtons();
      updateToggleButtons();
      loadTruancies();
    }
  } else {
    userInfo.textContent = "";
    loginBtn.classList.remove("hidden");
    loginBtn.classList.add("inline-block");
    logoutBtn.classList.add("hidden");
    content.classList.add("hidden");
  }
});

if (searchInput) {
  searchInput.addEventListener("input", () => {
    applyFiltersAndRender();
  });
}

sortButtons.forEach(button => {
  button.addEventListener("click", () => {
    currentSortKey = button.dataset.sortKey || "surname";
    sortAsc = true;
    updateSortButtons();
    applyFiltersAndRender();
  });
});

yearFilterButtons.forEach(button => {
  button.addEventListener("click", () => {
    const yearValue = button.dataset.yearFilter;
    if (!yearValue) return;

    if (!yearFilterIsCustom) {
      selectedYearFilters.clear();
      selectedYearFilters.add(yearValue);
      yearFilterIsCustom = true;
    } else if (selectedYearFilters.has(yearValue)) {
      selectedYearFilters.delete(yearValue);
    } else {
      selectedYearFilters.add(yearValue);
    }

    if (selectedYearFilters.size === 0) {
      YEAR_FILTER_OPTIONS.forEach(option => selectedYearFilters.add(option));
      yearFilterIsCustom = false;
    }

    updateYearFilterButtons();
    applyFiltersAndRender();
  });
});

if (toggleEscalatedBtn) {
  toggleEscalatedBtn.addEventListener("click", () => {
    showEscalated = !showEscalated;
    updateToggleButtons();
    applyFiltersAndRender();
  });
}

if (toggleResolvedBtn) {
  toggleResolvedBtn.addEventListener("click", () => {
    hideResolved = !hideResolved;
    updateToggleButtons();
    applyFiltersAndRender();
  });
}

document.addEventListener("click", (e) => {
  if (!tableBody) return;
  if (!e.target.matches(".toggle-details")) return;

  const studentId = e.target.dataset.studentId;
  if (!studentId) return;

  const detailsRow = tableBody.querySelector(`.details-row[data-student-id="${studentId}"]`);
  if (!detailsRow) return;

  const isHidden = detailsRow.classList.toggle("hidden");
  if (isHidden) {
    expandedStudentIds.delete(studentId);
  } else {
    expandedStudentIds.add(studentId);
  }

  e.target.innerHTML = isHidden ? "&#9654;" : "&#9660;";
});

tableHeaders.forEach((header, idx) => {
  header.addEventListener("click", () => {
    if (!tableBody) return;

    const keyMap = [
      null,
      "givenName",
      "surname",
      "yearGroup",
      "truancyCount",
      "rollClass",
      "latestDate",
      "arrivalTime",
      "minutesLate",
      "totalMinutesLate",
      "detentionsServed",
      "truancyResolved"
    ];

    const key = keyMap[idx];
    if (!key) return;

    if (key === currentSortKey) {
      sortAsc = !sortAsc;
    } else {
      currentSortKey = key;
      sortAsc = true;
    }

    updateSortButtons();
    applyFiltersAndRender();
  });
});

if (form && fileInput && statusDiv) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = fileInput.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    statusDiv.textContent = "Uploading...";

    try {
      const response = await fetch(BACKEND_URL, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (response.ok && data.status === "success") {
        statusDiv.textContent = buildUploadStatus(data);
        loadTruancies();
      } else {
        statusDiv.textContent = data.message || "Upload failed. Check file format.";
      }
    } catch (err) {
      console.error(err);
      statusDiv.textContent = "Error uploading file.";
    }
  });
}

async function loadTruancies() {
  if (!tableBody) return;

  tableBody.innerHTML = "";
  studentDataCache = [];

  const snapshot = await getDocs(collection(db, "students"));
  snapshot.forEach(docSnap => {
    const student = docSnap.data();
    const studentId = docSnap.id;

    if (!Array.isArray(student.truancies) || student.truancies.length === 0) return;

    const unresolved = student.truancies.filter(t => !t.justified);
    if (unresolved.length === 0) return;

    const latest = [...unresolved].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    const totalMinutesLate = unresolved.reduce((sum, t) => sum + (t.minutesLate || 0), 0);

    studentDataCache.push({
      studentId,
      givenName: student.givenName || "",
      surname: student.surname || "",
      yearGroup: resolveYearGroup(student),
      truancyCount: unresolved.length,
      rollClass: student.rollClass || "",
      latestDate: latest?.date ?? '-',
      arrivalTime: latest?.arrivalTime ?? '-',
      minutesLate: latest?.minutesLate ?? '-',
      totalMinutesLate,
      totalHoursLate: (totalMinutesLate / 60).toFixed(2),
      detentionsServed: student.detentionsServed || 0,
      truancyResolved: student.truancyResolved === true,
      escalated: !!student.escalated,
      truancies: student.truancies
    });
  });

  applyFiltersAndRender();
}

function applyFiltersAndRender() {
  if (!tableBody) return;

  const query = searchInput?.value.trim().toLowerCase() || "";

  filteredStudentData = studentDataCache
    .filter(student => {
      if (!showEscalated && student.escalated) return false;
      if (hideResolved && student.truancyResolved) return false;
      if (yearFilterButtons.length > 0 && !selectedYearFilters.has(String(student.yearGroup || "").toUpperCase())) return false;

      if (!query) return true;

      const haystack = [
        student.givenName,
        student.surname,
        student.rollClass
      ].join(" ").toLowerCase();

      return haystack.includes(query);
    })
    .sort((a, b) => compareStudents(a, b, currentSortKey, sortAsc));

  renderTable(filteredStudentData);
}

function renderTable(data) {
  if (!tableBody) return;

  tableBody.innerHTML = "";
  data.forEach((student) => {
    const tr = document.createElement("tr");
    if (student.truancyResolved) {
      tr.classList.add("resolved-row");
    }
    if (student.escalated) {
      tr.classList.add("escalated-row", "disabled-row");
    }

    tr.innerHTML = `
      <td><button class="toggle-details" data-student-id="${student.studentId}">${expandedStudentIds.has(student.studentId) ? "&#9660;" : "&#9654;"}</button></td>
      <td class="${student.escalated ? "greyed-name" : ""}">${student.givenName}</td>
      <td class="${student.escalated ? "greyed-name" : ""}">${student.surname}</td>
      <td>${student.yearGroup || '-'}</td>
      <td>${student.truancyCount}</td>
      <td>${student.rollClass}</td>
      <td>${student.latestDate}</td>
      <td>${student.arrivalTime}</td>
      <td>${student.minutesLate}</td>
      <td>${student.totalHoursLate}</td>
      <td>${student.detentionsServed}</td>
      <td>
        <span class="status-pill status-display ${student.truancyResolved ? "status-ok" : "status-pending"}">
          ${student.truancyResolved ? "Resolved" : "Pending"}
        </span>
      </td>
    `;
    tableBody.appendChild(tr);

    const detailsRow = document.createElement("tr");
    detailsRow.classList.add("details-row");
    detailsRow.dataset.studentId = student.studentId;
    if (!expandedStudentIds.has(student.studentId)) {
      detailsRow.classList.add("hidden");
    }

    detailsRow.innerHTML = `
      <td colspan="12">
        <table class="inner-table">
          <thead>
            <tr><th>Date</th><th>Arrival</th><th>Minutes Late</th><th>Explainer</th><th>Explainer Source</th><th>Description</th><th>Comment</th></tr>
          </thead>
          <tbody>
            ${student.truancies.map(t => `
              <tr>
                <td>${t.date}</td>
                <td>${t.arrivalTime || '-'}</td>
                <td>${t.minutesLate ?? '-'}</td>
                <td>${t.explainer || '-'}</td>
                <td>${t.explainerSource || '-'}</td>
                <td>${t.description || '-'}</td>
                <td>${t.comment || '-'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </td>
    `;
    tableBody.appendChild(detailsRow);
  });

  updateStats();
}

function updateStats() {
  if (!tableStats) return;

  const visibleCount = filteredStudentData.length;
  const resolvedCount = filteredStudentData.filter(student => student.truancyResolved).length;
  const escalatedCount = filteredStudentData.filter(student => student.escalated).length;

  tableStats.textContent = `${visibleCount} student(s) visible, ${resolvedCount} resolved, ${escalatedCount} escalated in this view.`;
}

function updateSortButtons() {
  sortButtons.forEach(button => {
    button.classList.toggle("active", button.dataset.sortKey === currentSortKey);
  });
}

function updateYearFilterButtons() {
  yearFilterButtons.forEach(button => {
    const yearValue = button.dataset.yearFilter || "";
    button.classList.toggle("active", !yearFilterIsCustom || selectedYearFilters.has(yearValue));
  });
}

function updateToggleButtons() {
  if (toggleResolvedBtn) {
    toggleResolvedBtn.classList.toggle("active", hideResolved);
    toggleResolvedBtn.textContent = hideResolved ? "Served Hidden" : "Served Visible";
  }

  if (toggleEscalatedBtn) {
    toggleEscalatedBtn.classList.toggle("active", showEscalated);
    toggleEscalatedBtn.textContent = showEscalated ? "Escalated Shown" : "Escalated Hidden";
  }
}

function getYearGroup(rollClass) {
  const match = String(rollClass).match(/\d+/);
  return match ? match[0] : '';
}

function resolveYearGroup(student) {
  const explicitYear = normalizeYearGroupValue(student.yearGroup);
  if (explicitYear) return explicitYear;

  const truancyYear = Array.isArray(student.truancies)
    ? student.truancies.map(entry => normalizeYearGroupValue(entry.yearGroup)).find(Boolean)
    : '';
  if (truancyYear) return truancyYear;

  return getYearGroup(student.rollClass || '');
}

function normalizeYearGroupValue(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  if (text.toUpperCase() === "SRC") {
    return "SRC";
  }

  if (text.endsWith('.0')) {
    return text.slice(0, -2);
  }

  const digits = text.match(/\d+/);
  return digits ? digits[0] : text;
}

function compareStudents(a, b, key, ascending) {
  const valA = a[key];
  const valB = b[key];

  if (key === 'yearGroup') {
    const numericA = Number.parseInt(valA, 10);
    const numericB = Number.parseInt(valB, 10);
    const bothNumeric = !Number.isNaN(numericA) && !Number.isNaN(numericB);
    if (bothNumeric && numericA !== numericB) {
      return ascending ? numericA - numericB : numericB - numericA;
    }
  }

  let primary;
  if (typeof valA === 'boolean' && typeof valB === 'boolean') {
    primary = ascending ? Number(valA) - Number(valB) : Number(valB) - Number(valA);
  } else if (typeof valA === 'number' && typeof valB === 'number') {
    primary = ascending ? valA - valB : valB - valA;
  } else {
    primary = ascending
      ? String(valA).localeCompare(String(valB))
      : String(valB).localeCompare(String(valA));
  }

  if (primary !== 0 || key === 'surname') return primary;
  return String(a.surname).localeCompare(String(b.surname)) || String(a.givenName).localeCompare(String(b.givenName));
}

function buildUploadStatus(data) {
  const reportDate = data.reportDate ? `Processed report for ${data.reportDate}. ` : "Processed upload. ";
  const latestObserved = data.latestObservedTime
    ? `Latest time found in the report: ${data.latestObservedTime}. `
    : "";
  const coverage = data.coversFullDay
    ? "This file appears to include full-day absence coverage. "
    : "This file does not yet appear to show full-day absence coverage, so some detention absence checks may stay pending until a later report is uploaded. ";
  const checksCompleted = data.detentionChecksCompleted
    ? `${data.detentionChecksCompleted} pending detention attendance check(s) were completed. `
    : "";
  const checksWaiting = data.pendingDetentionChecks
    ? `${data.pendingDetentionChecks} detention attendance check(s) are still waiting for fuller attendance data for that date.`
    : "";

  return `${reportDate}${data.added} late arrival(s) recorded. ${data.detentionsAssigned || 0} detention(s) assigned. ${checksCompleted}${latestObserved}${coverage}${checksWaiting}`.trim();
}
