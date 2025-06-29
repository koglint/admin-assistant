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
const tableBody = document.getElementById("detention-body");
const tableHeaders = document.querySelectorAll("#detention-table th");

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

async function loadDetentionSummary() {
  tableBody.innerHTML = "";
  detentionDataCache = [];

  const snapshot = await getDocs(collection(db, "students"));

  snapshot.forEach(docSnap => {
    const student = docSnap.data();

    if (!student.truancies || student.truancies.length === 0) return;

    const latest = [...student.truancies].sort((a, b) => new Date(b.date) - new Date(a.date))[0];

    detentionDataCache.push({
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

function renderDetentionTable(data) {
  tableBody.innerHTML = "";
  data.forEach(student => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${student.givenName}</td>
      <td>${student.surname}</td>
      <td>${student.rollClass}</td>
      <td>${student.latestDate}</td>
      <td>${student.truancyCount}</td>
      <td>${student.detentionsServed}</td>
      <td>${student.truancyResolved === true ? '✅' : student.truancyResolved === false ? '❌' : 'error'}</td>
    `;
    tableBody.appendChild(tr);
  });
}

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

      // Secondary sort by surname if not already sorting by it
      return String(a.surname).localeCompare(String(b.surname));
    });

    renderDetentionTable(sorted);
  });
});
