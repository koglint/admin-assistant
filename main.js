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

    if (!Array.isArray(student.truancies) || student.truancies.length === 0) return;

    const unresolved = student.truancies.filter(t => !t.justified);
    if (student.truancyResolved || unresolved.length === 0) return;

    const latest = [...unresolved].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    const totalMinutesLate = unresolved.reduce((sum, t) => sum + (t.minutesLate || 0), 0);

    studentDataCache.push({
      studentId,
      givenName: student.givenName,
      surname: student.surname,
      truancyCount: unresolved.length,
      rollClass: student.rollClass,
      latestDate: latest?.date ?? '-',
      arrivalTime: latest?.arrivalTime ?? '-',
      minutesLate: latest?.minutesLate ?? '-',
      totalMinutesLate,
      totalHoursLate: (totalMinutesLate / 60).toFixed(2),
      truancyResolved: student.truancyResolved ?? false,
      truancies: student.truancies
    });
  });

  renderTable(studentDataCache);
}

function renderTable(data) {
  tableBody.innerHTML = "";
  data.forEach((student, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><button class="toggle-details" data-index="${index}">&#9654;</button></td>
      <td>${student.givenName}</td>
      <td>${student.surname}</td>
      <td>${student.truancyCount}</td>
      <td>${student.rollClass}</td>
      <td>${student.latestDate}</td>
      <td>${student.arrivalTime}</td>
      <td>${student.minutesLate}</td>
      <td>${student.totalHoursLate}</td>
      <td>${student.truancyResolved ? "Yes" : "No"}</td>
    `;
    tableBody.appendChild(tr);

    const detailsRow = document.createElement("tr");
    detailsRow.classList.add("hidden", "details-row");
    detailsRow.innerHTML = `
      <td colspan="10">
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
}

document.addEventListener("click", (e) => {
  if (e.target.matches(".toggle-details")) {
    const index = Number(e.target.dataset.index);
    const detailsRow = tableBody.querySelectorAll(".details-row")[index];
    if (!detailsRow) return;

    detailsRow.classList.toggle("hidden");
    e.target.innerHTML = detailsRow.classList.contains("hidden") ? "&#9654;" : "&#9660;";
  }
});

tableHeaders.forEach((header, idx) => {
  header.addEventListener("click", () => {
    const keyMap = [
      null,
      "givenName",
      "surname",
      "truancyCount",
      "rollClass",
      "latestDate",
      "arrivalTime",
      "minutesLate",
      "totalMinutesLate",
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

    const sorted = [...studentDataCache].sort((a, b) => {
      const valA = a[key];
      const valB = b[key];

      let primary;
      if (typeof valA === 'boolean' && typeof valB === 'boolean') {
        primary = sortAsc ? Number(valA) - Number(valB) : Number(valB) - Number(valA);
      } else if (typeof valA === 'number' && typeof valB === 'number') {
        primary = sortAsc ? valA - valB : valB - valA;
      } else {
        primary = sortAsc
          ? String(valA).localeCompare(String(valB))
          : String(valB).localeCompare(String(valA));
      }

      if (primary !== 0 || key === 'surname') return primary;
      return String(a.surname).localeCompare(String(b.surname));
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
    if (response.ok && data.status === "success") {
      statusDiv.textContent = `Uploaded! ${data.added} truants recorded.`;
      loadTruancies();
    } else {
      statusDiv.textContent = data.message || "Upload failed. Check file format.";
    }
  } catch (err) {
    console.error(err);
    statusDiv.textContent = "Error uploading file.";
  }
});
