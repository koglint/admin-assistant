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
    tr.setAttribute("data-resolved", student.truancyResolved);

    tr.innerHTML = `
      <td><input type="checkbox" class="select-student" data-student-id="${student.studentId}"></td>
      <td>${student.givenName}</td>
      <td>${student.surname}</td>
      <td>${student.rollClass}</td>
      <td>${student.latestDate}</td>
      <td>${student.truancyCount}</td>
      <td>${student.detentionsServed}</td>
      <td>
        <span class="toggle-resolved" data-id="${student.studentId}" data-current="${student.truancyResolved}">
          ${student.truancyResolved === true ? '✅' : student.truancyResolved === false ? '❌' : 'error'}
        </span>
      </td>
      <td><button class="undo-btn" data-id="${student.studentId}">↩ Undo</button></td>
    `;

    tableBody.appendChild(tr);
  });
}

// Sorting logic
tableHeaders.forEach((header, idx) => {
  header.addEventListener("click", () => {
    const keyMap = [
      null, // Placeholder for checkbox column
      "givenName",
      "surname",
      "rollClass",
      "latestDate",
      "truancyCount",
      "detentionsServed",
      "truancyResolved",
      null // Placeholder for undo button column
    ];
    const key = keyMap[idx];

    if (key === currentSortKey) sortAsc = !sortAsc;
    else {
      currentSortKey = key;
      sortAsc = true;
    }

    const sorted = [...detentionDataCache].sort((a, b) => {
      const valA = a[key];
      const valB = b[key];
    
      let primary;
      if (typeof valA === 'boolean' && typeof valB === 'boolean') {
        // True = 1, False = 0
        primary = sortAsc ? (valA === valB ? 0 : valA ? -1 : 1) : (valA === valB ? 0 : valA ? 1 : -1);
      } else if (typeof valA === 'number' && typeof valB === 'number') {
        primary = sortAsc ? valA - valB : valB - valA;
      } else {
        primary = sortAsc
          ? String(valA).localeCompare(String(valB))
          : String(valB).localeCompare(String(valA));
      }
    
      // Fallback secondary sort by surname
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

// Manual override of truancyResolved
tableBody.addEventListener("click", async (e) => {
  if (e.target.classList.contains('toggle-resolved')) {
    const studentId = e.target.dataset.id;
    const current = e.target.dataset.current === 'true';
    const newValue = !current;

    const confirmed = window.confirm(`Set truancyResolved to ${newValue}?`);
    if (!confirmed) return;

    try {
      const ref = doc(db, "students", studentId);
      await updateDoc(ref, {
        truancyResolved: newValue
      });

      alert(`Truancy resolved set to ${newValue}`);
      await loadDetentionSummary();
    } catch (err) {
      console.error("Failed to update truancyResolved", err);
      alert("Error updating truancyResolved.");
    }
  }
});

const toggleResolvedBtn = document.getElementById("toggle-resolved-btn");
let hideResolved = false;

toggleResolvedBtn.addEventListener("click", () => {
  hideResolved = !hideResolved;

  document.querySelectorAll('#detention-body tr').forEach(row => {
    const isResolved = row.getAttribute("data-resolved") === "true";
    if (hideResolved && isResolved) {
      row.style.display = "none";
    } else {
      row.style.display = "";
    }
  });

  toggleResolvedBtn.textContent = hideResolved ? "Show Served" : "Hide Served";
});
