// main.js
import {
  auth,
  db,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from './firebase.js';

// Import Firestore methods directly from SDK
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

    studentDataCache.push({
      studentId,
      fullName: student.fullName,
      truancyCount: student.truancyCount,
      rollClass: student.rollClass,
      unresolvedCount,
      latestDate: latest?.date ?? '-',
      arrivalTime: latest?.arrivalTime ?? '-',
      minutesLate: latest?.minutesLate ?? '-',
      detentionIssued: latest?.detentionIssued ?? false,
      resolved: latest?.resolved ?? false,
      justified: latest?.justified ?? false,
      index: student.truancies.indexOf(latest)
    });
  });

  renderTable(studentDataCache);
}

function renderTable(data) {
  tableBody.innerHTML = "";
  data.forEach(student => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${student.fullName}</td>
      <td>${student.truancyCount}</td>
      <td>${student.rollClass}</td>
      <td>${student.unresolvedCount}</td>
      <td>${student.latestDate}</td>
      <td>${student.arrivalTime}</td>
      <td>${student.minutesLate}</td>
          `;
    tableBody.appendChild(tr);
  });
}

tableHeaders.forEach((header, idx) => {
  header.addEventListener("click", () => {
    const keyMap = [
      "fullName",
      "truancyCount",
      "rollClass",
      "unresolvedCount",
      "latestDate",
      "arrivalTime",
      "minutesLate",
      "detentionIssued",
      "resolved",
      "justified"
    ];
    const key = keyMap[idx];

    if (key === currentSortKey) sortAsc = !sortAsc;
    else {
      currentSortKey = key;
      sortAsc = true;
    }

    const sorted = [...studentDataCache].sort((a, b) => {
      if (typeof a[key] === 'number') {
        return sortAsc ? a[key] - b[key] : b[key] - a[key];
      } else if (typeof a[key] === 'boolean') {
        return sortAsc ? a[key] - b[key] : b[key] - a[key];
      } else {
        return sortAsc ? String(a[key]).localeCompare(String(b[key])) : String(b[key]).localeCompare(String(a[key]));
      }
    });

    renderTable(sorted);
  });
});

document.addEventListener("click", async (e) => {
  if (e.target.matches(".toggle")) {
    const studentId = e.target.dataset.stu;
    const index = parseInt(e.target.dataset.idx);
    const field = e.target.dataset.field;

    const docRef = doc(db, "students", studentId);
    const docSnap = await getDoc(docRef);
    const data = docSnap.data();

    const updated = [...data.truancies];
    updated[index][field] = !updated[index][field];

    await updateDoc(docRef, { truancies: updated });
    loadTruancies();
  }
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
