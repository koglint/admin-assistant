// main.js
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
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const content = document.getElementById('content');
const tableBody = document.getElementById("truancy-body");
const tableHeaders = document.querySelectorAll("#truancy-table th");

let currentSortKey = null;
let sortAsc = true;
let studentDataCache = [];

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
    userInfo.textContent = `Signed in as: ${user.displayName} (${user.email})`;
    loginBtn.classList.add("hidden");
    logoutBtn.classList.remove("hidden");
    logoutBtn.classList.add("inline-block");
    content.classList.remove("hidden");
    content.classList.add("visible");
    loadTruancies();
  } else {
    userInfo.textContent = "";
    loginBtn.classList.remove("hidden");
    loginBtn.classList.add("inline-block");
    logoutBtn.classList.add("hidden");
    content.classList.add("hidden");
  }
});

async function loadTruancies() {
  tableBody.innerHTML = "";
  studentDataCache = [];

  const snapshot = await getDocs(collection(db, "students"));
  snapshot.forEach(docSnap => {
    const student = docSnap.data();
    const studentId = docSnap.id;

    if (!student.truancies) return;

    const unresolved = student.truancies.filter(t => !t.resolved && !t.justified);
    const unresolvedCount = unresolved.length;
    const latest = unresolved.sort((a, b) => new Date(b.date) - new Date(a.date))[0];

    const totalMinutesLate = student.truancies
      .filter(t => !t.justified)
      .reduce((sum, t) => sum + (t.minutesLate || 0), 0);

    const totalHoursLate = (totalMinutesLate / 60).toFixed(2);

    studentDataCache.push({
      studentId,
      fullName: student.fullName,
      truancyCount: student.truancyCount,
      rollClass: student.rollClass,
      latestDate: latest?.date ?? '-',
      arrivalTime: latest?.arrivalTime ?? '-',
      minutesLate: latest?.minutesLate ?? '-',
      totalMinutesLate,
      totalHoursLate,
      truancyResolved: student.truancyResolved ?? false,
      truancies: student.truancies || [],  // 👈 This fixes the error
      index: student.truancies.indexOf(latest)
    });
    
  });

  renderTable(studentDataCache);
}

function renderTable(data) {
  tableBody.innerHTML = "";
  data.forEach((student, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><button class="toggle-details" data-index="${index}">▶</button> ${student.fullName}</td>
      <td>${student.truancyCount}</td>
      <td>${student.rollClass}</td>
      <td>${student.latestDate}</td>
      <td>${student.arrivalTime}</td>
      <td>${student.minutesLate}</td>
      <td>${student.totalHoursLate}</td>
      <td>${student.truancyResolved ? "✅" : "❌"}</td>

    `;
    tableBody.appendChild(tr);

    const detailsRow = document.createElement("tr");
    detailsRow.classList.add("hidden", "details-row");
    detailsRow.innerHTML = `
      <td colspan="8">
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
                <td>${t.explainer}</td>
                <td>${t.explainerSource}</td>
                <td>${t.description}</td>
                <td>${t.comment || '-'}</td>

              </tr>`).join('')}
          </tbody>
        </table>
      </td>
    `;
    tableBody.appendChild(detailsRow);
  });
}

document.addEventListener("click", (e) => {
  if (e.target.matches(".toggle-details")) {
    const index = e.target.dataset.index;
    const detailsRow = tableBody.querySelectorAll(".details-row")[index];
    detailsRow.classList.toggle("hidden");
    e.target.textContent = detailsRow.classList.contains("hidden") ? "▶" : "▼";
  }
});

tableHeaders.forEach((header, idx) => {
  header.addEventListener("click", () => {
    const keyMap = [
      "fullName",
      "truancyCount",
      "rollClass",
      "latestDate",
      "arrivalTime",
      "minutesLate",
      "totalMinutesLate",
      "truancyResolved"
    ];
    const key = keyMap[idx];

    if (key === currentSortKey) sortAsc = !sortAsc;
    else {
      currentSortKey = key;
      sortAsc = true;
    }

    const sorted = [...studentDataCache].sort((a, b) => {
      const primary = (typeof a[key] === 'number' || typeof a[key] === 'boolean')
        ? (sortAsc ? a[key] - b[key] : b[key] - a[key])
        : (sortAsc ? String(a[key]).localeCompare(String(b[key])) : String(b[key]).localeCompare(String(a[key])));

      if (primary !== 0 || key === 'surnameKey') return primary;

      // Secondary sort by surnameKey if not already sorting by it
      return String(a.surnameKey).localeCompare(String(b.surnameKey));
    });

    renderTable(sorted);
  });
});

const form = document.getElementById('upload-form');
const fileInput = document.getElementById('xls-file');
const statusDiv = document.getElementById('upload-status');

const BACKEND_URL = "https://admin-assistant-backend.onrender.com/upload";

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
    if (data.status === "success") {
      statusDiv.textContent = `Uploaded! ${data.added} truants recorded.`;
      loadTruancies();
    } else {
      statusDiv.textContent = "Upload failed. Check file format.";
    }
  } catch (err) {
    console.error(err);
    statusDiv.textContent = "Error uploading file.";
  }
});
