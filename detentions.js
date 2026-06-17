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
  getDocs,
  doc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const content = document.getElementById('content');
const tableBody = document.getElementById("detention-body");
const markPresentBtn = document.getElementById("mark-present-btn");
const selectAllBtn = document.getElementById("select-all-btn");
const unselectAllBtn = document.getElementById("unselect-all-btn");
const toggleResolvedBtn = document.getElementById("toggle-resolved-btn");
const searchInput = document.getElementById("detention-search");
const sortButtons = document.querySelectorAll(".sort-btn");
const sortableHeaders = document.querySelectorAll("#detention-table thead th[data-sort-key]");
const yearFilterButtons = document.querySelectorAll(".year-filter-btn");
const tableStats = document.getElementById("table-stats");
const diagnosticsPanel = document.getElementById("diagnostics-panel");
const diagnosticsStatus = document.getElementById("diagnostics-status");
const SELECTION_STORAGE_KEY = "attendanceAssistant.detentionSelection";
const YEAR_FILTER_OPTIONS = ["7", "8", "9", "10", "11", "12", "SRC"];

let hideResolved = true;
let sortKey = "yearGroup";
let sortDirection = "asc";
let detentionDataCache = [];
let filteredDetentionData = [];
const selectedStudentIds = new Set();
const selectedYearFilters = new Set(YEAR_FILTER_OPTIONS);
let yearFilterIsCustom = false;
let currentUserDescriptor = "unknown_user";

loginBtn.onclick = async () => {
  const provider = new GoogleAuthProvider();
  try {
    setDiagnostics("Opening Google sign-in...");
    await signInWithPopup(auth, provider);
  } catch (err) {
    alert("Login failed");
    console.error("[Detention diagnostics] Login failed", err);
    setDiagnostics(`Login failed: ${formatErrorForDisplay(err)}`, true);
  }
};

logoutBtn.onclick = () => {
  signOut(auth);
};

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUserDescriptor = buildUserDescriptor(user);
    userInfo.textContent = `Signed in as: ${user.displayName} (${user.email})`;
    loginBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";
    content.style.display = "block";

    console.info("[Detention diagnostics] Signed in user", {
      email: user.email,
      uid: user.uid,
      emailVerified: user.emailVerified,
      providerIds: user.providerData.map(provider => provider.providerId),
      projectId: auth.app?.options?.projectId
    });
    setDiagnostics(`Signed in as ${user.email || user.uid}. Checking Firestore access...`);

    try {
      const tokenResult = await user.getIdTokenResult();
      console.info("[Detention diagnostics] ID token claims", {
        email: tokenResult.claims.email,
        emailVerified: tokenResult.claims.email_verified,
        signInProvider: tokenResult.signInProvider,
        authTime: tokenResult.authTime,
        issuedAtTime: tokenResult.issuedAtTime,
        expirationTime: tokenResult.expirationTime
      });
    } catch (err) {
      console.error("[Detention diagnostics] Could not read ID token result", err);
      setDiagnostics(`Signed in, but could not inspect the Firebase ID token: ${formatErrorForDisplay(err)}`, true);
    }

    await loadDetentionSummary();
    updateSortButtons();
    updateSortableHeaders();
    updateYearFilterButtons();
    updateToggleButtons();
  } else {
    currentUserDescriptor = "unknown_user";
    userInfo.textContent = "";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    content.style.display = "none";
    setDiagnostics("");
  }
});

toggleResolvedBtn.addEventListener("click", () => {
  hideResolved = !hideResolved;
  updateToggleButtons();
  applyFiltersAndRender();
});

searchInput.addEventListener("input", () => {
  applyFiltersAndRender();
});

sortButtons.forEach(button => {
  button.addEventListener("click", () => {
    setSortKey(button.dataset.sortKey || "surname");
  });
});

sortableHeaders.forEach(header => {
  header.addEventListener("click", () => {
    setSortKey(header.dataset.sortKey || "surname");
  });
});

function setSortKey(nextSortKey) {
  if (sortKey === nextSortKey) {
    sortDirection = sortDirection === "asc" ? "desc" : "asc";
  } else {
    sortKey = nextSortKey;
    sortDirection = "asc";
  }

  updateSortButtons();
  updateSortableHeaders();
  applyFiltersAndRender();
}

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

selectAllBtn.addEventListener("click", () => {
  filteredDetentionData.forEach(student => {
    selectedStudentIds.add(student.studentId);
  });
  persistSelectedStudents();
  renderDetentionTable(filteredDetentionData);
});

unselectAllBtn.addEventListener("click", () => {
  selectedStudentIds.clear();
  persistSelectedStudents();
  renderDetentionTable(filteredDetentionData);
});

markPresentBtn.addEventListener("click", async () => {
  const selectedIds = [...selectedStudentIds];

  if (selectedIds.length === 0) {
    alert("No students selected.");
    return;
  }

  const confirmed = confirm(
    `Process today's detention roll?\n\n`
    + `Present/served: ${selectedIds.length}\n\n`
    + `This will clear all selected students' outstanding detentions due on or before today.`
  );
  if (!confirmed) return;

  const servedCount = await markSelectedPresent(selectedIds);
  clearSelectedStudents();
  await loadDetentionSummary();
  alert(
    `Detention roll processed.\n\n`
    + `${servedCount} student(s) marked as successfully completed detention.`
  );
});

tableBody.addEventListener("change", (e) => {
  if (!e.target.matches(".select-student")) return;

  const studentId = e.target.dataset.studentId;
  if (e.target.checked) {
    selectedStudentIds.add(studentId);
  } else {
    selectedStudentIds.delete(studentId);
  }

  persistSelectedStudents();
  updateStats();
});

tableBody.addEventListener("click", async (e) => {
  if (e.target.matches('.undo-btn')) {
    const studentId = e.target.dataset.id;
    const confirmUndo = window.confirm("Are you sure you want to undo the last detention served?");
    if (!confirmUndo) return;

    try {
      const updated = await undoServedDetention(studentId);
      if (updated) {
        selectedStudentIds.delete(studentId);
        persistSelectedStudents();
        await loadDetentionSummary();
        alert("Detention record updated.");
      } else {
        alert("No detentions to undo.");
      }
    } catch (err) {
      console.error("Failed to undo detention", err);
      alert("Failed to undo detention.");
    }
  }
});

async function loadDetentionSummary() {
  restoreSelectedStudents();
  detentionDataCache = [];

  setDiagnostics("Loading Firestore collection: students...");
  console.info("[Detention diagnostics] Starting Firestore read", {
    collection: "students",
    currentUserEmail: auth.currentUser?.email || null,
    currentUserUid: auth.currentUser?.uid || null,
    projectId: auth.app?.options?.projectId
  });

  let snapshot;
  try {
    snapshot = await getDocs(collection(db, "students"));
  } catch (err) {
    detentionDataCache = [];
    filteredDetentionData = [];
    tableBody.innerHTML = `<tr><td colspan="10">Could not load student data. Check diagnostics above and the browser console.</td></tr>`;
    tableStats.textContent = "Firestore load failed.";
    console.error("[Detention diagnostics] Firestore students read failed", {
      code: err.code,
      name: err.name,
      message: err.message,
      stack: err.stack
    });
    setDiagnostics(`Firestore read failed for ${auth.currentUser?.email || "current user"}: ${formatErrorForDisplay(err)}`, true);
    return;
  }

  let studentsWithLateArrivals = 0;
  let studentsWithoutLateArrivals = 0;
  let studentsHiddenByYearFilter = 0;
  let studentsHiddenAsResolved = 0;

  snapshot.forEach(docSnap => {
    const student = docSnap.data();
    const id = docSnap.id;

    if (!Array.isArray(student.lateArrivals) || student.lateArrivals.length === 0) {
      studentsWithoutLateArrivals += 1;
      return;
    }

    studentsWithLateArrivals += 1;

    const latest = [...student.lateArrivals].sort((a, b) => new Date(b.date) - new Date(a.date))[0];

    const detentions = getDetentionLedger(student);
    const detentionServedEvents = getDetentionServedEvents(student);
    const detentionStatus = buildDetentionStatus(detentions, detentionServedEvents);

    detentionDataCache.push({
      studentId: id,
      givenName: student.givenName || "",
      surname: student.surname || "",
      rollClass: student.rollClass || "",
      yearGroup: resolveYearGroup(student),
      latestDate: latest?.date ?? '-',
      lateCount: student.lateCount || 0,
      detentionsServed: student.detentionsServed || 0,
      detentions,
      detentionServedEvents,
      detentionStatus,
      outstandingCount: detentionStatus.outstandingCount,
      oldestOutstandingDetentionDate: detentionStatus.oldestOutstandingDetentionDate || "-",
      resolved: !detentionStatus.hasOpenDetention
    });
  });

  detentionDataCache.forEach(student => {
    if (!selectedYearFilters.has(String(student.yearGroup || "").toUpperCase())) studentsHiddenByYearFilter += 1;
    if (hideResolved && student.resolved) studentsHiddenAsResolved += 1;
  });

  console.info("[Detention diagnostics] Firestore students read succeeded", {
    totalDocs: snapshot.size,
    studentsWithLateArrivals,
    studentsWithoutLateArrivals,
    studentsCachedForDetentionPage: detentionDataCache.length,
    filters: {
      selectedYearFilters: [...selectedYearFilters],
      hideResolved,
      studentsHiddenByYearFilter,
      studentsHiddenAsResolved
    }
  });
  setDiagnostics(`Firestore read succeeded for ${auth.currentUser?.email || "current user"}: ${snapshot.size} student document(s), ${studentsWithLateArrivals} with late-arrival records before filters.`);
  applyFiltersAndRender();
}

function setDiagnostics(message, isError = false) {
  if (!diagnosticsPanel || !diagnosticsStatus) return;

  diagnosticsPanel.style.display = message ? "block" : "none";
  diagnosticsStatus.textContent = message;
  diagnosticsStatus.classList.toggle("error-text", isError);
  diagnosticsStatus.classList.toggle("success-text", Boolean(message) && !isError);
}

function formatErrorForDisplay(err) {
  if (!err) return "Unknown error";

  const parts = [];
  if (err.code) parts.push(err.code);
  if (err.message) parts.push(err.message);
  return parts.join(" - ") || String(err);
}

function applyFiltersAndRender() {
  const query = searchInput.value.trim().toLowerCase();

  filteredDetentionData = detentionDataCache
    .filter(student => {
      if (hideResolved && student.resolved) return false;
      if (!selectedYearFilters.has(String(student.yearGroup || "").toUpperCase())) return false;

      if (!query) return true;

      const haystack = [
        student.givenName,
        student.surname,
        student.rollClass
      ].join(" ").toLowerCase();

      return haystack.includes(query);
    })
    .sort(compareStudents);

  renderDetentionTable(filteredDetentionData);
}

function compareStudents(a, b) {
  const key = sortKey;
  const directionMultiplier = sortDirection === "desc" ? -1 : 1;
  const valA = normalizeSortValue(a[key], key);
  const valB = normalizeSortValue(b[key], key);
  const fallbackCompare = compareStudentFallbacks(a, b, key);

  if (key === "yearGroup") {
    const numericA = Number.parseInt(valA, 10);
    const numericB = Number.parseInt(valB, 10);
    const bothNumeric = !Number.isNaN(numericA) && !Number.isNaN(numericB);

    if (bothNumeric && numericA !== numericB) {
      return (numericA - numericB) * directionMultiplier;
    }

    const yearTextCompare = String(valA).localeCompare(String(valB));
    if (yearTextCompare !== 0) return yearTextCompare * directionMultiplier;
    return fallbackCompare * directionMultiplier;
  }

  if (typeof valA === "number" && typeof valB === "number" && valA !== valB) {
    return (valA - valB) * directionMultiplier;
  }

  const primary = String(valA).localeCompare(String(valB));
  if (primary !== 0) return primary * directionMultiplier;

  return fallbackCompare * directionMultiplier;
}

function normalizeSortValue(value, key) {
  if (["lateCount", "detentionsServed", "outstandingCount"].includes(key)) {
    return Number(value) || 0;
  }

  if (key === "resolved") {
    return value ? 1 : 0;
  }

  if (key === "latestDate" || key === "oldestOutstandingDetentionDate") {
    return value === "-" ? "" : String(value || "");
  }

  return value ?? "";
}

function compareStudentFallbacks(a, b, key) {
  if (key !== "surname") {
    const surnameFallback = String(a.surname).localeCompare(String(b.surname));
    if (surnameFallback !== 0) return surnameFallback;
  }

  return String(a.givenName).localeCompare(String(b.givenName));
}

function renderDetentionTable(data) {
  tableBody.innerHTML = "";

  if (data.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="12">No students match the current detention roll filters.</td>';
    tableBody.appendChild(row);
  }

  data.forEach(student => {
    const tr = document.createElement("tr");
    tr.setAttribute("data-resolved", student.resolved);

    tr.innerHTML = `
      <td data-label="Select"><input type="checkbox" class="select-student" data-student-id="${student.studentId}" ${selectedStudentIds.has(student.studentId) ? "checked" : ""}></td>
      <td data-label="Given Name">${student.givenName}</td>
      <td data-label="Surname">${student.surname}</td>
      <td data-label="Year">${student.yearGroup || '-'}</td>
      <td data-label="Roll Class">${student.rollClass}</td>
      <td data-label="Last Late">${student.latestDate}</td>
      <td data-label="Late Count">${student.lateCount}</td>
      <td data-label="Outstanding">${student.outstandingCount}</td>
      <td data-label="Oldest Due">${student.oldestOutstandingDetentionDate}</td>
      <td data-label="Detentions Served">${student.detentionsServed}</td>
      <td data-label="Resolved">
        <span class="status-pill status-display ${student.resolved ? "status-ok" : "status-pending"}">
          ${student.resolved ? 'Resolved' : 'Pending'}
        </span>
      </td>
      <td data-label="Undo"><button class="undo-btn" data-id="${student.studentId}">Undo</button></td>
    `;

    tableBody.appendChild(tr);
  });

  updateStats();
}

function updateStats() {
  const visibleCount = filteredDetentionData.length;
  const selectedVisibleCount = filteredDetentionData.filter(student => selectedStudentIds.has(student.studentId)).length;
  tableStats.textContent = `${visibleCount} student(s) visible, ${selectedVisibleCount} selected in this view.`;

  if (diagnosticsStatus?.textContent?.startsWith("Firestore read succeeded")) {
    console.info("[Detention diagnostics] Rendered detention table", {
      cachedStudentsBeforeFilters: detentionDataCache.length,
      visibleStudentsAfterFilters: visibleCount,
      selectedVisibleCount,
      searchTextLength: searchInput.value.trim().length,
      selectedYearFilters: [...selectedYearFilters],
      hideResolved
    });
  }
}

function updateSortButtons() {
  sortButtons.forEach(button => {
    button.classList.toggle("active", button.dataset.sortKey === sortKey);
    const directionLabel = sortDirection === "asc" ? "ascending" : "descending";
    button.setAttribute(
      "aria-label",
      button.dataset.sortKey === sortKey
        ? `Sorted by ${button.textContent.trim()} ${directionLabel}`
        : `Sort by ${button.textContent.trim()}`
    );
  });
}

function updateSortableHeaders() {
  sortableHeaders.forEach(header => {
    const isActive = header.dataset.sortKey === sortKey;
    const directionLabel = sortDirection === "asc" ? "ascending" : "descending";
    const button = header.querySelector(".table-sort-heading");

    header.classList.toggle("sorted", isActive);
    header.classList.toggle("sorted-desc", isActive && sortDirection === "desc");
    header.setAttribute("aria-sort", isActive ? directionLabel : "none");

    if (button) {
      button.setAttribute(
        "aria-label",
        isActive
          ? `Sorted by ${button.textContent.trim()} ${directionLabel}. Click to reverse.`
          : `Sort by ${button.textContent.trim()}`
      );
    }
  });
}

function updateToggleButtons() {
  toggleResolvedBtn.classList.toggle("active", hideResolved);
  toggleResolvedBtn.textContent = hideResolved ? "Served Hidden" : "Served Visible";
}

function updateYearFilterButtons() {
  yearFilterButtons.forEach(button => {
    const yearValue = button.dataset.yearFilter || "";
    button.classList.toggle("active", !yearFilterIsCustom || selectedYearFilters.has(yearValue));
  });
}

function persistSelectedStudents() {
  localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify([...selectedStudentIds]));
}

function clearSelectedStudents() {
  selectedStudentIds.clear();
  persistSelectedStudents();
}

function restoreSelectedStudents() {
  try {
    const stored = localStorage.getItem(SELECTION_STORAGE_KEY);
    selectedStudentIds.clear();
    if (!stored) return;

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return;

    parsed.forEach(studentId => {
      if (typeof studentId === "string" && studentId) {
        selectedStudentIds.add(studentId);
      }
    });
  } catch (err) {
    console.error("Failed to restore detention selections", err);
    selectedStudentIds.clear();
  }
}

function getYearGroup(rollClass) {
  const match = String(rollClass).match(/\d+/);
  return match ? match[0] : "";
}

function resolveYearGroup(student) {
  const explicitYear = normalizeYearGroupValue(student.yearGroup);
  if (explicitYear) return explicitYear;

  const lateArrivalYear = Array.isArray(student.lateArrivals)
    ? student.lateArrivals.map(entry => normalizeYearGroupValue(entry.yearGroup)).find(Boolean)
    : "";
  if (lateArrivalYear) return lateArrivalYear;

  return getYearGroup(student.rollClass || "");
}

function normalizeYearGroupValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  if (text.toUpperCase() === "SRC") {
    return "SRC";
  }

  if (text.endsWith(".0")) {
    return text.slice(0, -2);
  }

  const digits = text.match(/\d+/);
  return digits ? digits[0] : text;
}

async function updateSelectedStudents(selectedIds, updater) {
  let updatedCount = 0;
  for (const studentId of selectedIds) {
    try {
      const updated = await updater(studentId);
      if (updated) {
        updatedCount += 1;
      }
    } catch (err) {
      console.error(`Failed to update ${studentId}`, err);
    }
  }

  return updatedCount;
}

function getLocalDateString() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find(part => part.type === "year")?.value || "";
  const month = parts.find(part => part.type === "month")?.value || "";
  const day = parts.find(part => part.type === "day")?.value || "";
  return `${year}-${month}-${day}`;
}

function nextSchoolDay(dateString) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  const next = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  next.setUTCDate(next.getUTCDate() + 1);

  while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

async function markSelectedPresent(selectedIds) {
  return updateSelectedStudents(selectedIds, async (studentId) => {
    const ref = doc(db, "students", studentId);
    return runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) return false;

      const data = snap.data();
      const today = getLocalDateString();
      const detentions = getDetentionLedger(data);
      const detentionServedEvents = getDetentionServedEvents(data);
      const latestServedDate = getLatestServedDate(detentionServedEvents);
      const outstandingDue = getOutstandingDetentions(detentions, latestServedDate)
        .filter(detention => (detention.originalScheduledForDate || "") <= today);

      if (outstandingDue.length === 0) {
        return false;
      }

      const currentCount = data.detentionsServed || 0;
      const history = Array.isArray(data.detentionHistory) ? [...data.detentionHistory] : [];
      const servedEvent = {
        servedDate: today,
        markedAt: new Date().toISOString(),
        markedBy: currentUserDescriptor,
        source: "detention_roll"
      };
      const nextServedEvents = [...detentionServedEvents, servedEvent];
      const nextStatus = buildDetentionStatus(detentions, nextServedEvents);
      history.push({
        date: today,
        outcome: "served",
        resolvedDetentionIds: outstandingDue.map(detention => detention.detentionId)
      });

      transaction.update(ref, {
        detentionsServed: currentCount + 1,
        lastDetentionServedDate: today,
        detentions,
        detentionServedEvents: nextServedEvents,
        detentionStatus: nextStatus,
        activeDetention: null,
        detentionHistory: history,
        updatedAt: serverTimestamp(),
        updatedBy: currentUserDescriptor,
        lastAction: "detention_marked_present",
        lastRollMark: "present",
        lastRollMarkedAt: serverTimestamp()
      });
      return true;
    });
  });
}

async function undoServedDetention(studentId) {
  const ref = doc(db, "students", studentId);
  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) return false;

    const student = snap.data();
    const currentCount = student.detentionsServed || 0;
    if (currentCount <= 0) return false;

    const history = Array.isArray(student.detentionHistory) ? [...student.detentionHistory] : [];
    const detentions = getDetentionLedger(student);
    const servedEvents = getDetentionServedEvents(student);
    if (servedEvents.length === 0) return false;

    const lastServedIndex = [...history].reverse().findIndex(entry => entry.outcome === "served");

    if (lastServedIndex !== -1) {
      const actualIndex = history.length - 1 - lastServedIndex;
      history.splice(actualIndex, 1);
    }

    const nextServedEvents = servedEvents.slice(0, -1);
    const nextStatus = buildDetentionStatus(detentions, nextServedEvents);

    transaction.update(ref, {
      detentionsServed: currentCount - 1,
      lastDetentionServedDate: getLatestServedDate(nextServedEvents) || null,
      detentions,
      detentionServedEvents: nextServedEvents,
      detentionStatus: nextStatus,
      activeDetention: null,
      detentionHistory: history,
      updatedAt: serverTimestamp(),
      updatedBy: currentUserDescriptor,
      lastAction: "detention_undo"
    });
    return true;
  });
}

function buildUserDescriptor(user) {
  if (!user) return "unknown_user";
  return user.email || user.displayName || user.uid || "unknown_user";
}

function isStudentResolved(student) {
  const status = student.detentionStatus || buildDetentionStatus(getDetentionLedger(student), getDetentionServedEvents(student));
  return !status.hasOpenDetention;
}

function getDetentionLedger(student) {
  const detentions = Array.isArray(student.detentions) ? [...student.detentions] : [];
  const activeDetention = student.activeDetention;

  if (activeDetention?.status === "open") {
    const sourceLateDate = activeDetention.createdFromLateDate || activeDetention.scheduledForDate || "";
    const detentionId = sourceLateDate || activeDetention.scheduledForDate || "legacy_active_detention";
    if (!detentions.some(detention => detention?.detentionId === detentionId)) {
      detentions.push({
        detentionId,
        sourceLateDate,
        originalScheduledForDate: activeDetention.scheduledForDate || sourceLateDate,
        createdAt: activeDetention.createdAt || "",
        createdBy: "legacy_active_detention_migration",
        sourceContext: activeDetention.sourceContext || "legacy_active_detention"
      });
    }
  }

  return detentions
    .filter(detention => detention && detention.originalScheduledForDate)
    .sort((a, b) => String(a.originalScheduledForDate).localeCompare(String(b.originalScheduledForDate)));
}

function getDetentionServedEvents(student) {
  const explicitEvents = Array.isArray(student.detentionServedEvents)
    ? [...student.detentionServedEvents]
        .filter(event => event?.servedDate)
        .sort((a, b) => String(a.servedDate).localeCompare(String(b.servedDate)) || String(a.markedAt || "").localeCompare(String(b.markedAt || "")))
    : [];

  if (explicitEvents.length > 0) {
    return explicitEvents;
  }

  const history = Array.isArray(student.detentionHistory) ? student.detentionHistory : [];
  return history
    .filter(entry => entry?.outcome === "served" && (entry.date || entry.scheduledForDate))
    .map(entry => ({
      servedDate: entry.date || entry.scheduledForDate,
      markedAt: entry.date || entry.scheduledForDate,
      markedBy: "legacy_detention_history",
      source: "legacy_detention_history"
    }))
    .sort((a, b) => String(a.servedDate).localeCompare(String(b.servedDate)));
}

function buildDetentionStatus(detentions, servedEvents) {
  const latestServedDate = getLatestServedDate(servedEvents);
  const outstanding = getOutstandingDetentions(detentions, latestServedDate);
  const dates = outstanding
    .map(detention => detention.originalScheduledForDate)
    .filter(Boolean)
    .sort();

  return {
    hasOpenDetention: outstanding.length > 0,
    outstandingCount: outstanding.length,
    latestServedDate,
    oldestOutstandingDetentionDate: dates[0] || null,
    newestOutstandingDetentionDate: dates[dates.length - 1] || null
  };
}

function getOutstandingDetentions(detentions, latestServedDate) {
  return detentions.filter(detention => {
    const scheduledDate = detention?.originalScheduledForDate;
    if (!scheduledDate) return false;
    return !latestServedDate || scheduledDate > latestServedDate;
  });
}

function getLatestServedDate(servedEvents) {
  const dates = servedEvents
    .map(event => event?.servedDate)
    .filter(Boolean)
    .sort();
  return dates[dates.length - 1] || null;
}
