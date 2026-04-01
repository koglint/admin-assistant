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
  getDoc,
  doc,
  updateDoc,
  deleteField
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const content = document.getElementById('content');
const tableBody = document.getElementById("detention-body");
const markPresentBtn = document.getElementById("mark-present-btn");
const markAbsentBtn = document.getElementById("mark-absent-btn");
const selectAllBtn = document.getElementById("select-all-btn");
const unselectAllBtn = document.getElementById("unselect-all-btn");
const toggleEscalatedBtn = document.getElementById("toggle-escalated-btn");
const toggleResolvedBtn = document.getElementById("toggle-resolved-btn");
const searchInput = document.getElementById("detention-search");
const sortSelect = document.getElementById("sort-select");
const tableStats = document.getElementById("table-stats");

let showEscalated = false;
let hideResolved = false;
let sortKey = "surname";
let detentionDataCache = [];
let filteredDetentionData = [];
const selectedStudentIds = new Set();

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

onAuthStateChanged(auth, async (user) => {
  if (user) {
    userInfo.textContent = `Signed in as: ${user.displayName} (${user.email})`;
    loginBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";
    content.style.display = "block";
    await loadDetentionSummary();
  } else {
    userInfo.textContent = "";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    content.style.display = "none";
  }
});

toggleEscalatedBtn.addEventListener("click", () => {
  showEscalated = !showEscalated;
  toggleEscalatedBtn.textContent = showEscalated ? "Hide Escalated" : "Show Escalated";
  applyFiltersAndRender();
});

toggleResolvedBtn.addEventListener("click", () => {
  hideResolved = !hideResolved;
  toggleResolvedBtn.textContent = hideResolved ? "Show Served" : "Hide Served";
  applyFiltersAndRender();
});

searchInput.addEventListener("input", () => {
  applyFiltersAndRender();
});

sortSelect.addEventListener("change", () => {
  sortKey = sortSelect.value;
  applyFiltersAndRender();
});

selectAllBtn.addEventListener("click", () => {
  filteredDetentionData.forEach(student => {
    selectedStudentIds.add(student.studentId);
  });
  renderDetentionTable(filteredDetentionData);
});

unselectAllBtn.addEventListener("click", () => {
  selectedStudentIds.clear();
  renderDetentionTable(filteredDetentionData);
});

markPresentBtn.addEventListener("click", async () => {
  const selectedIds = [...selectedStudentIds];
  if (selectedIds.length === 0) {
    alert("No students selected.");
    return;
  }

  const confirmed = confirm(`Mark ${selectedIds.length} student(s) as present for detention?`);
  if (!confirmed) return;

  await updateSelectedStudents(selectedIds, async (ref, data) => {
    const currentCount = data.detentionsServed || 0;
    const today = new Date().toISOString().split("T")[0];
    const latestTruancyDate = getLatestTruancyDate(data.truancies);
    const truancyResolved = Boolean(latestTruancyDate && today >= latestTruancyDate);

    await updateDoc(ref, {
      detentionsServed: currentCount + 1,
      lastDetentionServedDate: today,
      truancyResolved
    });
  });

  alert("Selected students marked present.");
});

markAbsentBtn.addEventListener("click", async () => {
  const selectedIds = [...selectedStudentIds];
  if (selectedIds.length === 0) {
    alert("No students selected.");
    return;
  }

  const confirmed = confirm(`Mark ${selectedIds.length} student(s) as absent for detention? This will keep them unresolved.`);
  if (!confirmed) return;

  await updateSelectedStudents(selectedIds, async (ref) => {
    await updateDoc(ref, {
      truancyResolved: false,
      lastDetentionServedDate: deleteField()
    });
  });

  alert("Selected students marked absent.");
});

tableBody.addEventListener("change", (e) => {
  if (!e.target.matches(".select-student")) return;

  const studentId = e.target.dataset.studentId;
  if (e.target.checked) {
    selectedStudentIds.add(studentId);
  } else {
    selectedStudentIds.delete(studentId);
  }

  updateStats();
});

tableBody.addEventListener("click", async (e) => {
  if (e.target.matches('.undo-btn')) {
    const studentId = e.target.dataset.id;
    const confirmUndo = window.confirm("Are you sure you want to undo the last detention served?");
    if (!confirmUndo) return;

    try {
      const ref = doc(db, "students", studentId);
      const snap = await getDoc(ref);
      const student = snap.data();
      const currentCount = student.detentionsServed || 0;

      if (currentCount > 0) {
        await updateDoc(ref, {
          detentionsServed: currentCount - 1,
          truancyResolved: false,
          lastDetentionServedDate: deleteField()
        });

        selectedStudentIds.delete(studentId);
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

  if (e.target.classList.contains('toggle-resolved')) {
    const studentId = e.target.dataset.id;
    const current = e.target.dataset.current === 'true';
    const newValue = !current;

    const confirmed = window.confirm(`Set truancyResolved to ${newValue}?`);
    if (!confirmed) return;

    try {
      const ref = doc(db, "students", studentId);
      const updates = {
        truancyResolved: newValue
      };

      if (!newValue) {
        updates.lastDetentionServedDate = deleteField();
      }

      await updateDoc(ref, updates);
      await loadDetentionSummary();
      alert(`Truancy resolved set to ${newValue}`);
    } catch (err) {
      console.error("Failed to update truancyResolved", err);
      alert("Error updating truancyResolved.");
    }
  }
});

async function loadDetentionSummary() {
  selectedStudentIds.clear();
  detentionDataCache = [];

  const snapshot = await getDocs(collection(db, "students"));
  snapshot.forEach(docSnap => {
    const student = docSnap.data();
    const id = docSnap.id;

    if (!Array.isArray(student.truancies) || student.truancies.length === 0) return;

    const latest = [...student.truancies].sort((a, b) => new Date(b.date) - new Date(a.date))[0];

    detentionDataCache.push({
      studentId: id,
      givenName: student.givenName || "",
      surname: student.surname || "",
      rollClass: student.rollClass || "",
      latestDate: latest?.date ?? '-',
      truancyCount: student.truancyCount || 0,
      detentionsServed: student.detentionsServed || 0,
      truancyResolved: student.truancyResolved === true,
      escalated: !!student.escalated
    });
  });

  applyFiltersAndRender();
}

function applyFiltersAndRender() {
  const query = searchInput.value.trim().toLowerCase();

  filteredDetentionData = detentionDataCache
    .filter(student => {
      if (!showEscalated && student.escalated) return false;
      if (hideResolved && student.truancyResolved) return false;

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
  const valA = a[key];
  const valB = b[key];

  if (key === "latestDate") {
    return String(valB).localeCompare(String(valA));
  }

  const primary = String(valA).localeCompare(String(valB));
  if (primary !== 0) return primary;

  if (key !== "surname") {
    const surnameFallback = String(a.surname).localeCompare(String(b.surname));
    if (surnameFallback !== 0) return surnameFallback;
  }

  return String(a.givenName).localeCompare(String(b.givenName));
}

function renderDetentionTable(data) {
  tableBody.innerHTML = "";

  data.forEach(student => {
    const tr = document.createElement("tr");
    tr.setAttribute("data-resolved", student.truancyResolved);

    if (student.escalated) {
      tr.classList.add("escalated-row");
    }

    tr.innerHTML = `
      <td><input type="checkbox" class="select-student" data-student-id="${student.studentId}" ${selectedStudentIds.has(student.studentId) ? "checked" : ""}></td>
      <td>${student.givenName}</td>
      <td>${student.surname}</td>
      <td>${student.rollClass}</td>
      <td>${student.latestDate}</td>
      <td>${student.truancyCount}</td>
      <td>${student.detentionsServed}</td>
      <td>
        <span class="status-pill ${student.truancyResolved ? "status-ok" : "status-pending"} toggle-resolved" data-id="${student.studentId}" data-current="${student.truancyResolved}">
          ${student.truancyResolved ? 'Resolved' : 'Pending'}
        </span>
      </td>
      <td><button class="undo-btn" data-id="${student.studentId}">Undo</button></td>
    `;

    tableBody.appendChild(tr);
  });

  updateStats();
}

function updateStats() {
  const visibleCount = filteredDetentionData.length;
  const selectedVisibleCount = filteredDetentionData.filter(student => selectedStudentIds.has(student.studentId)).length;
  tableStats.textContent = `${visibleCount} student(s) visible, ${selectedVisibleCount} selected in this view.`;
}

function getLatestTruancyDate(truancies) {
  if (!Array.isArray(truancies) || truancies.length === 0) return null;

  return truancies
    .map(t => new Date(t.date))
    .sort((a, b) => b - a)[0]
    ?.toISOString().split("T")[0] || null;
}

async function updateSelectedStudents(selectedIds, updater) {
  for (const studentId of selectedIds) {
    try {
      const ref = doc(db, "students", studentId);
      const snap = await getDoc(ref);
      const data = snap.data();
      await updater(ref, data);
    } catch (err) {
      console.error(`Failed to update ${studentId}`, err);
    }
  }

  await loadDetentionSummary();
}
