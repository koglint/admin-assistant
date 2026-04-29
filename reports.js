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
const generateMissedDetentionEventsBtn = document.getElementById("generate-missed-detention-events-report");
const generateMissedDetentionsBtn = document.getElementById("generate-missed-detentions-report");
const generateLateCountBtn = document.getElementById("generate-late-count-report");
const generateCombinedEscalationBtn = document.getElementById("generate-combined-escalation-report");
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

generateMissedDetentionEventsBtn.addEventListener("click", () => {
  exportMissedDetentionEventsReport();
});

generateMissedDetentionsBtn.addEventListener("click", () => {
  exportEscalationSubsetReport("missed_detention_twice");
});

generateLateCountBtn.addEventListener("click", () => {
  exportEscalationSubsetReport("late_count_over_five");
});

generateCombinedEscalationBtn.addEventListener("click", () => {
  exportEscalationSubsetReport("combined");
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
      yearGroup: resolveYearGroup(data),
      lateCount: data.lateCount || data.truancyCount || 0,
      detentionsServed: data.detentionsServed || 0,
      escalated: !!data.escalated,
      escalationReasons: data.escalationReasons || [],
      detentionHistory: data.detentionHistory || [],
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

function exportMissedDetentionEventsReport() {
  const date = getFormattedDate();
  const rows = buildMissedDetentionRows();

  if (rows.length === 0) {
    alert("No missed detention records were found.");
    return;
  }

  if (exportFormat.value === "pdf") {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.text("Missed Detention Report", 14, 15);
    doc.autoTable({
      startY: 22,
      head: [["Missed Date", "Day", "Surname", "Given Name", "Year", "Roll Class", "Scheduled Date", "Attendance At School", "Outcome", "Missed Count"]],
      body: rows.map(row => [
        row.missedDate,
        row.day,
        row.surname,
        row.givenName,
        row.yearGroup,
        row.rollClass,
        row.scheduledForDate,
        row.attendanceAtSchool,
        row.outcomeLabel,
        row.missedCount
      ]),
      styles: { fontSize: 8 }
    });
    doc.save(`missed_detentions_by_day_${date}.pdf`);
    return;
  }

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Missed Detentions");
  XLSX.writeFile(workbook, `missed_detentions_by_day_${date}.xlsx`);
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

function exportEscalationSubsetReport(reportType) {
  const date = getFormattedDate();
  const rows = allStudents
    .filter(student => matchesEscalationReport(student, reportType))
    .map(student => ({
      surname: student.surname,
      givenName: student.givenName,
      yearGroup: student.yearGroup || '',
      rollClass: student.rollClass,
      lateCount: student.lateCount,
      missedDetentionsWhilePresent: getMissedWhilePresentCount(student),
      activeDetention: student.activeDetention?.scheduledForDate || '',
      escalationReasons: formatReasons(student.escalationReasons)
    }))
    .sort((a, b) => a.surname.localeCompare(b.surname) || a.givenName.localeCompare(b.givenName));

  if (rows.length === 0) {
    alert("No students matched that report.");
    return;
  }

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Escalation Report");

  const filename = reportType === "missed_detention_twice"
    ? `missed_two_detentions_${date}.xlsx`
    : reportType === "late_count_over_five"
      ? `late_more_than_five_${date}.xlsx`
      : `combined_escalation_${date}.xlsx`;

  XLSX.writeFile(workbook, filename);
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

function getMissedWhilePresentCount(student) {
  const historyCount = Array.isArray(student.detentionHistory)
    ? student.detentionHistory.filter(entry => entry.outcome === "missed_while_present").length
    : 0;

  return Math.max(historyCount, student.activeDetention?.missedWhilePresentCount || 0);
}

function buildMissedDetentionRows() {
  return allStudents
    .flatMap(student => getMissedDetentionHistory(student).map((entry, index) => ({
      missedDate: entry.date || entry.scheduledForDate || '',
      day: formatWeekday(entry.date || entry.scheduledForDate || ''),
      surname: student.surname,
      givenName: student.givenName,
      yearGroup: student.yearGroup || '',
      rollClass: student.rollClass,
      scheduledForDate: entry.scheduledForDate || entry.date || '',
      attendanceAtSchool: getAttendanceAtSchoolLabel(entry),
      outcomeLabel: getMissedDetentionOutcomeLabel(entry),
      missedCount: index + 1
    })))
    .sort((a, b) =>
      String(a.missedDate).localeCompare(String(b.missedDate)) ||
      a.surname.localeCompare(b.surname) ||
      a.givenName.localeCompare(b.givenName)
    );
}

function getMissedDetentionHistory(student) {
  const history = Array.isArray(student.detentionHistory)
    ? student.detentionHistory.filter(entry =>
      entry.outcome === "missed_while_present" || entry.outcome === "absent_from_school"
    )
    : [];

  const pendingEntry = student.activeDetention?.pendingAttendanceCheckDate
    ? [{
      date: student.activeDetention.pendingAttendanceCheckDate,
      scheduledForDate: student.activeDetention.scheduledForDate || student.activeDetention.pendingAttendanceCheckDate,
      outcome: "pending_attendance_check"
    }]
    : [];

  return [...history, ...pendingEntry].sort((a, b) =>
    String(a.date || a.scheduledForDate || '').localeCompare(String(b.date || b.scheduledForDate || ''))
  );
}

function getAttendanceAtSchoolLabel(entry) {
  if (entry.outcome === "missed_while_present") return "Present";
  if (entry.outcome === "absent_from_school") return "Absent";
  return "Pending check";
}

function getMissedDetentionOutcomeLabel(entry) {
  if (entry.outcome === "missed_while_present") return "Missed detention while present";
  if (entry.outcome === "absent_from_school") return "Missed detention while absent from school";
  return "Missed detention awaiting attendance confirmation";
}

function formatWeekday(dateText) {
  const match = String(dateText || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.toLocaleDateString('en-AU', { weekday: 'long' });
}

function matchesEscalationReport(student, reportType) {
  const missedTwice = getMissedWhilePresentCount(student) >= 2 || student.escalationReasons.includes("missed_detention_twice");
  const lateOverFive = student.lateCount > 5 || student.escalationReasons.includes("late_count_over_five");

  if (reportType === "missed_detention_twice") return missedTwice;
  if (reportType === "late_count_over_five") return lateOverFive;
  return missedTwice || lateOverFive;
}

function getYearGroup(rollClass) {
  const match = String(rollClass).match(/\d+/);
  return match ? match[0] : '';
}

function resolveYearGroup(student) {
  const explicitYear = normalizeYearGroupValue(student.yearGroup);
  if (explicitYear) return explicitYear;

  const truancyYear = Array.isArray(student.lateArrivals || student.truancies)
    ? (student.lateArrivals || student.truancies).map(entry => normalizeYearGroupValue(entry.yearGroup)).find(Boolean)
    : '';
  if (truancyYear) return truancyYear;

  return getYearGroup(student.rollClass || '');
}

function normalizeYearGroupValue(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  if (text.endsWith('.0')) {
    return text.slice(0, -2);
  }

  const digits = text.match(/\d+/);
  return digits ? digits[0] : text;
}

function formatReasons(reasons) {
  if (!reasons || reasons.length === 0) return 'No';
  return reasons.join(', ');
}
