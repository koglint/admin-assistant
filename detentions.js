// detentions.js
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
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// UI elements
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const content = document.getElementById('content');
const tableBody = document.getElementById("detention-body");
const tableHeaders = document.querySelectorAll("#detention-table th");
const markBtn = document.getElementById("mark-present-btn");
const selectAllBtn = document.getElementById("select-all-btn");
const unselectAllBtn = document.getElementById("unselect-all-btn");

let currentSortKey = null;
let sortAsc = true;
let detentionDataCache = [];

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

// Load data
async function loadDetentionSummary() {
  tableBody.innerHTML = "";
  detentionDataCache = [];

  const snapshot = await getDocs(collection(db, "students"));

  snapshot.forEach(docSnap => {
    const student = docSnap.data();
    const id = docSnap.id;

    if (!student.truancies || student.truancies.length === 0) return;

    const latest = [...student.truancies].sort((a, b) => new Date(b.date) - new Date(a.date))[0];

    detentionDataCache.push({
      studentId: id,
      givenName: student.givenName,
      surname: student.surname,
      rollClass: student.rollClass,
      latestDate: latest?.date ?? '-',
      truancyCount: student.truancyCount || 0,
      detentionsServed: student.detentionsServed || 0,
      truancyResolved: student.truancyResolved
    });
  });

  renderDetentionTable(detentionDataCache);
}

// Render table
function renderDetentionTable(data) {
  tableBody.innerHTML = "";
  data.forEach(student => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" class="select-student" data-student-id="${student.studentId}"></td>
      <td>${student.givenName}</td>
      <td>${student.surname}</td>
      <td>${student.rollClass}</td>
      <td>${student.latestDate}</td>
      <td>${student.truancyCount}</td>
      <td>${student.detentionsServed}</td>
      <td>${student.truancyResolved === true ? '✅' : student.truancyResolved === false ? '❌' : 'error'}</td>
      <td><button class="undo-btn" data-id="${student.studentId}">↩ Undo</button></td>
    `;

    tableBody.appendChild(tr);
  });
}

// Sorting logic
tableHeaders.forEach((header, idx) => {
  header.addEventListener("click", () => {
    const keyMap = [
      "givenName",
      "surname",
      "rollClass",
      "latestDate",
      "truancyCount",
      "detentionsServed",
      "truancyResolved"
    ];
    const key = keyMap[idx];

    if (key === currentSortKey) sortAsc = !sortAsc;
    else {
      currentSortKey = key;
      sortAsc = true;
    }

    const sorted = [...detentionDataCache].sort((a, b) => {
      const primary = (typeof a[key] === 'number' || typeof a[key] === 'boolean')
        ? (sortAsc ? a[key] - b[key] : b[key] - a[key])
        : (sortAsc ? String(a[key]).localeCompare(String(b[key])) : String(b[key]).localeCompare(String(a[key])));

      if (primary !== 0 || key === 'surname') return primary;
      return String(a.surname).localeCompare(String(b.surname));
    });

    renderDetentionTable(sorted);
  });
});

// Handle "Mark selected as present"
markBtn.addEventListener("click", async () => {
  const selected = [...document.querySelectorAll(".select-student:checked")];
  if (selected.length === 0) {
    alert("No students selected.");
    return;
  }

  const confirmed = confirm(`Mark ${selected.length} student(s) as present for detention?`);
  if (!confirmed) return;

  for (const checkbox of selected) {
    const studentId = checkbox.dataset.studentId;
    try {
      const ref = doc(db, "students", studentId);
      const snap = await getDoc(ref);
      const data = snap.data();

      const currentCount = data.detentionsServed || 0;
      const today = new Date().toISOString().split("T")[0];

      // Find latest truancy date
      let latestTruancyDate = null;
      if (Array.isArray(data.truancies) && data.truancies.length > 0) {
        latestTruancyDate = data.truancies
          .map(t => new Date(t.date))
          .sort((a, b) => b - a)[0]
          ?.toISOString().split("T")[0];
      }

      // Determine if resolved
      let truancyResolved = false;
      if (latestTruancyDate && today >= latestTruancyDate) {
        truancyResolved = true;
      }

      await updateDoc(ref, {
        detentionsServed: currentCount + 1,
        lastDetentionServedDate: today,
        truancyResolved
      });

    } catch (err) {
      console.error(`Failed to update ${studentId}`, err);
    }
  }

  await loadDetentionSummary();
  alert("Marked as present.");
});

// Select/unselect all
selectAllBtn.addEventListener("click", () => {
  document.querySelectorAll(".select-student").forEach(cb => cb.checked = true);
});

unselectAllBtn.addEventListener("click", () => {
  document.querySelectorAll(".select-student").forEach(cb => cb.checked = false);
});

// Undo detention mark
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
          detentionsServed: currentCount - 1
        });
        alert("Detention record updated.");
        await loadDetentionSummary();
      } else {
        alert("No detentions to undo.");
      }
    } catch (err) {
      console.error("Failed to undo detention", err);
    }
  }
});
