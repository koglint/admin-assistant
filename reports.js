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

const jsPDF = window.jspdf.jsPDF;
import 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.5.28/+esm';
import * as XLSX from 'https://cdn.sheetjs.com/xlsx-latest/package/xlsx.mjs';

const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const content = document.getElementById("content");
const exportFormat = document.getElementById("export-format");
const generateSummaryBtn = document.getElementById("generate-summary-report");
const generateHistoryBtn = document.getElementById("generate-history-report");
const historyScope = document.getElementById("history-scope");
const studentSearch = document.getElementById("student-search");
const rollClassSelect = document.getElementById("roll-class-select");
const yearGroupSelect = document.getElementById("year-group-select");
const studentPicker = document.getElementById("student-picker");

let allStudents = [];
const selectedStudentIds = new Set();

loginBtn.onclick = async () => {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider).catch(err => {
    alert("Login failed");
    console.error(err);
  });
};

logoutBtn.onclick = () => signOut(auth);

onAuthStateChanged(auth, async user => {
  if (user) {
    userInfo.textContent = `Signed in as: ${user.displayName} (${user.email})`;
    loginBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";
    content.style.display = "block";
    await loadStudents();
    renderFilters();
    renderStudentPicker();
  } else {
    userInfo.textContent = "";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    content.style.display = "none";
  }
});

historyScope.addEventListener("change", () => {
  selectedStudentIds.clear();
  renderStudentPicker();
});

studentSearch.addEventListener("input", renderStudentPicker);
rollClassSelect.addEventListener("change", renderStudentPicker);
yearGroupSelect.addEventListener("change", renderStudentPicker);

studentPicker.addEventListener("change", (e) => {
  if (!e.target.matches(".student-choice")) return;
  const id = e.target.value;

  if (historyScope.value === "single") {
    selectedStudentIds.clear();
  }

  if (e.target.checked) {
    selectedStudentIds.add(id);
  } else {
    selectedStudentIds.delete(id);
  }

  renderStudentPicker();
});

generateSummaryBtn.addEventListener("click", () => {
  exportSummaryReport();
});

generateHistoryBtn.addEventListener("click", () => {
  exportHistoryReport();
});

async function loadStudents() {
  const snapshot = await getDocs(collection(db, "students"));
  allStudents = snapshot.docs.map(docSnap => {
    const data = docSnap.data();
    return {
      studentId: docSnap.id,
      surname: data.surname || '',
      givenName: data.givenName || '',
      rollClass: data.rollClass || '',
      yearGroup: getYearGroup(data.rollClass || ''),
      lateCount: data.lateCount || data.truancyCount || 0,
      detentionsServed: data.detentionsServed || 0,
      escalated: !!data.escalated,
      escalationReasons: data.escalationReasons || [],
      lateArrivals: data.lateArrivals || data.truancies || [],
      activeDetention: data.activeDetention || null
    };
  }).sort((a, b) => a.surname.localeCompare(b.surname) || a.givenName.localeCompare(b.givenName));
}

function renderFilters() {
  const rollClasses = [...new Set(allStudents.map(student => student.rollClass).filter(Boolean))].sort();
  const yearGroups = [...new Set(allStudents.map(student => student.yearGroup).filter(Boolean))].sort((a, b) => Number(a) - Number(b));

  rollClassSelect.innerHTML = '<option value="">All Roll Classes</option>' + rollClasses.map(value => `<option value="${value}">${value}</option>`).join('');
  yearGroupSelect.innerHTML = '<option value="">All Year Groups</option>' + yearGroups.map(value => `<option value="${value}">${value}</option>`).join('');
}

function renderStudentPicker() {
  const search = studentSearch.value.trim().toLowerCase();
  const scope = historyScope.value;
  const rollClass = rollClassSelect.value;
  const yearGroup = yearGroupSelect.value;

  const visibleStudents = allStudents.filter(student => {
    if (rollClass && student.rollClass !== rollClass) return false;
    if (yearGroup && student.yearGroup !== yearGroup) return false;

    if (!search) return true;
    return `${student.givenName} ${student.surname} ${student.rollClass}`.toLowerCase().includes(search);
  });

  studentPicker.innerHTML = visibleStudents.map(student => `
    <label class="student-choice-row ${scope === 'single' ? 'single-choice' : ''}">
      <input
        class="student-choice"
        type="${scope === 'single' ? 'radio' : 'checkbox'}"
        name="student-selection"
        value="${student.studentId}"
        ${selectedStudentIds.has(student.studentId) ? 'checked' : ''}
      />
      <span>${student.surname}, ${student.givenName} (${student.rollClass})</span>
    </label>
  `).join('');
}

function exportSummaryReport() {
  const date = getFormattedDate();
  const rows = allStudents.map(student => ({
    surname: student.surname,
    givenName: student.givenName,
    rollClass: student.rollClass,
    lateCount: student.lateCount,
    detentionsServed: student.detentionsServed,
    activeDetention: student.activeDetention?.scheduledForDate || 'None',
    escalated: student.escalated ? 'Yes' : 'No',
    escalationReasons: formatReasons(student.escalationReasons)
  }));

  if (exportFormat.value === "pdf") {
    const doc = new jsPDF();
    doc.text("Attendance Assistant Summary Report", 14, 15);
    doc.autoTable({
      startY: 22,
      head: [["Surname", "Given Name", "Roll Class", "Late Count", "Detentions Served", "Active Detention", "Escalated", "Reasons"]],
      body: rows.map(row => [row.surname, row.givenName, row.rollClass, row.lateCount, row.detentionsServed, row.activeDetention, row.escalated, row.escalationReasons]),
      styles: { fontSize: 8 }
    });
    doc.save(`attendance_summary_${date}.pdf`);
    return;
  }

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Summary");
  XLSX.writeFile(workbook, `attendance_summary_${date}.xlsx`);
}

function exportHistoryReport() {
  const selectedStudents = resolveHistorySelection();
  if (selectedStudents.length === 0) {
    alert("Select at least one student for the history report.");
    return;
  }

  const date = getFormattedDate();
  const historyRows = selectedStudents.flatMap(student => {
    const arrivals = [...student.lateArrivals].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return arrivals.map(arrival => ({
      studentId: student.studentId,
      surname: student.surname,
      givenName: student.givenName,
      rollClass: student.rollClass,
      date: arrival.date || '',
      arrivalTime: arrival.arrivalTime || '',
      minutesLate: arrival.minutesLate ?? '',
      shorthand: arrival.shorthand || '',
      description: arrival.description || '',
      detentionAssignedFor: student.activeDetention?.scheduledForDate || '',
      escalated: student.escalated ? 'Yes' : 'No'
    }));
  });

  if (historyRows.length === 0) {
    alert("No late-arrival history was found for the selected student(s).");
    return;
  }

  if (exportFormat.value === "pdf") {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.text("Student Late Arrival History", 14, 15);
    doc.autoTable({
      startY: 22,
      head: [["Student ID", "Surname", "Given Name", "Roll Class", "Date", "Arrival Time", "Minutes Late", "Shorthand", "Description", "Escalated"]],
      body: historyRows.map(row => [row.studentId, row.surname, row.givenName, row.rollClass, row.date, row.arrivalTime, row.minutesLate, row.shorthand, row.description, row.escalated]),
      styles: { fontSize: 8 }
    });
    doc.save(`student_history_${date}.pdf`);
    return;
  }

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(historyRows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Student History");
  XLSX.writeFile(workbook, `student_history_${date}.xlsx`);
}

function resolveHistorySelection() {
  const scope = historyScope.value;
  const rollClass = rollClassSelect.value;
  const yearGroup = yearGroupSelect.value;

  if (scope === "rollClass") {
    return allStudents.filter(student => !rollClass || student.rollClass === rollClass);
  }

  if (scope === "yearGroup") {
    return allStudents.filter(student => !yearGroup || student.yearGroup === yearGroup);
  }

  return allStudents.filter(student => selectedStudentIds.has(student.studentId));
}

function getFormattedDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getYearGroup(rollClass) {
  const match = String(rollClass).match(/\d+/);
  return match ? match[0] : '';
}

function formatReasons(reasons) {
  if (!reasons || reasons.length === 0) return 'No';
  return reasons.join(', ');
}
