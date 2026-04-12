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

const jsPDF = window.jspdf.jsPDF;
import 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.5.28/+esm';
import * as XLSX from 'https://cdn.sheetjs.com/xlsx-latest/package/xlsx.mjs';

const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const content = document.getElementById('content');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const escalatedBody = document.getElementById('escalated-body');
const escalationStats = document.getElementById('escalation-stats');
const exportFormat = document.getElementById('export-format');
const exportEscalatedBtn = document.getElementById('export-escalated-report');

let allStudents = [];
let currentUserDescriptor = "unknown_user";

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
    currentUserDescriptor = buildUserDescriptor(user);
    userInfo.textContent = `Signed in as: ${user.displayName} (${user.email})`;
    loginBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";
    content.style.display = "block";
    await refreshPage();
  } else {
    currentUserDescriptor = "unknown_user";
    userInfo.textContent = "";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    content.style.display = "none";
  }
});

searchInput.addEventListener('input', (e) => {
  renderSearchResults(e.target.value);
});

exportEscalatedBtn.addEventListener("click", () => {
  exportEscalatedReport();
});

document.addEventListener('click', async (e) => {
  if (e.target.classList.contains('add-escalated')) {
    const student = allStudents.find(item => item.studentId === e.target.dataset.id);
    if (!student) return;

    await runTransaction(db, async (transaction) => {
      const ref = doc(db, 'students', student.studentId);
      const snap = await transaction.get(ref);
      if (!snap.exists()) return;

      const data = snap.data();
      transaction.update(ref, {
        escalated: true,
        manualEscalation: true,
        escalationReasons: ['manual_escalation'],
        escalationSuppression: data.escalationSuppression || {
          lateCountUntil: 0,
          missedCountUntil: 0
        },
        updatedAt: serverTimestamp(),
        updatedBy: currentUserDescriptor,
        lastAction: "manual_escalation_added"
      });
    });

    await refreshPage();
  }

  if (e.target.classList.contains('return-to-roll')) {
    const student = allStudents.find(item => item.studentId === e.target.dataset.id);
    if (!student) return;

    await runTransaction(db, async (transaction) => {
      const ref = doc(db, 'students', student.studentId);
      const snap = await transaction.get(ref);
      if (!snap.exists()) return;

      const data = snap.data();
      transaction.update(ref, {
        escalated: false,
        manualEscalation: false,
        escalationReasons: [],
        escalationSuppression: {
          lateCountUntil: data.lateCount || data.truancyCount || 0,
          missedCountUntil: data.activeDetention?.missedWhilePresentCount || 0
        },
        updatedAt: serverTimestamp(),
        updatedBy: currentUserDescriptor,
        lastAction: "manual_escalation_return_to_roll"
      });
    });

    await refreshPage();
  }

  if (e.target.classList.contains('clear-escalation')) {
    const student = allStudents.find(item => item.studentId === e.target.dataset.id);
    if (!student) return;

    await runTransaction(db, async (transaction) => {
      const ref = doc(db, 'students', student.studentId);
      const snap = await transaction.get(ref);
      if (!snap.exists()) return;

      const data = snap.data();
      const history = Array.isArray(data.detentionHistory) ? [...data.detentionHistory] : [];
      history.push({
        date: new Date().toISOString().split("T")[0],
        outcome: "cleared_after_escalation"
      });

      transaction.update(ref, {
        escalated: false,
        manualEscalation: false,
        escalationReasons: [],
        activeDetention: null,
        truancyResolved: true,
        escalationSuppression: {
          lateCountUntil: data.lateCount || data.truancyCount || 0,
          missedCountUntil: data.activeDetention?.missedWhilePresentCount || 0
        },
        detentionHistory: history,
        updatedAt: serverTimestamp(),
        updatedBy: currentUserDescriptor,
        lastAction: "manual_escalation_cleared"
      });
    });

    await refreshPage();
  }
});

async function refreshPage() {
  await loadAllStudents();
  renderEscalatedList();
  renderSearchResults(searchInput.value || '');
  updateStats();
}

async function loadAllStudents() {
  const snapshot = await getDocs(collection(db, 'students'));
  allStudents = snapshot.docs.map(docSnap => {
    const student = docSnap.data();
    return {
      studentId: docSnap.id,
      givenName: student.givenName || '',
      surname: student.surname || '',
      name: `${student.givenName || ''} ${student.surname || ''}`.trim(),
      rollClass: student.rollClass || '',
      yearGroup: resolveYearGroup(student),
      lateCount: student.lateCount || student.truancyCount || 0,
      escalated: !!student.escalated,
      escalationReasons: student.escalationReasons || [],
      activeDetention: student.activeDetention || null,
      detentionHistory: student.detentionHistory || []
    };
  }).sort((a, b) => a.rollClass.localeCompare(b.rollClass) || a.surname.localeCompare(b.surname) || a.givenName.localeCompare(b.givenName));
}

function renderEscalatedList() {
  escalatedBody.innerHTML = '';

  const escalatedStudents = getEscalatedStudents();
  if (escalatedStudents.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="7">No students are currently escalated.</td>';
    escalatedBody.appendChild(row);
    return;
  }

  escalatedStudents.forEach(student => {
    const row = document.createElement('tr');
    row.classList.add('escalated-row');
    row.innerHTML = `
      <td>${student.name}</td>
      <td>${student.yearGroup || '-'}</td>
      <td>${student.rollClass}</td>
      <td>${student.lateCount}</td>
      <td>${formatReasons(student.escalationReasons)}</td>
      <td>${formatDetentionStatus(student.activeDetention)}</td>
      <td>
        <button class="return-to-roll" data-id="${student.studentId}">Return to Detention Roll</button>
        <button class="clear-escalation secondary-btn" data-id="${student.studentId}">Clear</button>
      </td>
    `;
    escalatedBody.appendChild(row);
  });
}

function renderSearchResults(query) {
  searchResults.innerHTML = '';

  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return;

  const matches = allStudents
    .filter(student => !student.escalated)
    .filter(student =>
      student.name.toLowerCase().includes(trimmed) ||
      student.rollClass.toLowerCase().includes(trimmed)
    );

  if (matches.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No matching students found.';
    searchResults.appendChild(li);
    return;
  }

  matches.forEach(student => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${student.name} (${student.rollClass || 'No roll class'})</span>
      <button data-id="${student.studentId}" class="add-escalated">Escalate</button>
    `;
    searchResults.appendChild(li);
  });
}

function updateStats() {
  const escalatedStudents = getEscalatedStudents();
  const manualCount = escalatedStudents.filter(student => student.escalationReasons.includes("manual_escalation")).length;
  escalationStats.textContent = `${escalatedStudents.length} student(s) currently escalated. ${manualCount} marked manually.`;
}

function exportEscalatedReport() {
  const rows = getEscalatedStudents().map(student => ({
    surname: student.surname,
    givenName: student.givenName,
    yearGroup: student.yearGroup || '',
    rollClass: student.rollClass,
    lateCount: student.lateCount,
    detentionStatus: formatDetentionStatus(student.activeDetention),
    escalationReasons: formatReasons(student.escalationReasons)
  }));

  if (rows.length === 0) {
    alert("No students are currently escalated.");
    return;
  }

  const date = getFormattedDate();

  if (exportFormat.value === "pdf") {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.text("Escalated Students Report", 14, 15);
    doc.autoTable({
      startY: 22,
      head: [["Surname", "Given Name", "Year", "Roll Class", "Late Count", "Detention Status", "Reasons"]],
      body: rows.map(row => [row.surname, row.givenName, row.yearGroup, row.rollClass, row.lateCount, row.detentionStatus, row.escalationReasons]),
      styles: { fontSize: 8 }
    });
    doc.save(`escalated_students_${date}.pdf`);
    return;
  }

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Escalated Students");
  XLSX.writeFile(workbook, `escalated_students_${date}.xlsx`);
}

function getEscalatedStudents() {
  return allStudents.filter(student => student.escalated);
}

function getFormattedDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

function formatReasons(reasons) {
  if (!reasons || reasons.length === 0) return 'Manual';

  return reasons.map(reason => {
    switch (reason) {
      case 'manual_escalation':
        return 'Manual';
      case 'late_count_over_five':
        return 'Late Count > 5';
      case 'missed_detention_twice':
        return 'Missed Detention Twice';
      default:
        return reason;
    }
  }).join(', ');
}

function formatDetentionStatus(activeDetention) {
  if (!activeDetention || activeDetention.status !== 'open') {
    return 'No active detention';
  }

  return `Owed for ${activeDetention.scheduledForDate}`;
}

function buildUserDescriptor(user) {
  if (!user) return "unknown_user";
  return user.email || user.displayName || user.uid || "unknown_user";
}
