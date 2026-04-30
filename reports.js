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

const BACKEND_BASE_URL = "https://admin-assistant-backend.onrender.com";
const ATTENDANCE_DAY_LOOKUP_URL = `${BACKEND_BASE_URL}/attendance-days/lookup`;

const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const content = document.getElementById("content");
const exportFormat = document.getElementById("export-format");
const generateSummaryBtn = document.getElementById("generate-summary-report");
const generateMissedDetentionEventsBtn = document.getElementById("generate-missed-detention-events-report");
const generateMissedDetentionPdfBtn = document.getElementById("generate-missed-detention-pdf");
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
const attendanceDaysByKey = new Map();
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

generateMissedDetentionEventsBtn.addEventListener("click", async () => {
  await runWithButtonLoading(generateMissedDetentionEventsBtn, "Generating...", exportMissedDetentionEventsReport);
});

generateMissedDetentionPdfBtn.addEventListener("click", async () => {
  await runWithButtonLoading(generateMissedDetentionPdfBtn, "Generating...", exportMissedDetentionNoticePdf);
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

async function runWithButtonLoading(button, loadingText, action) {
  const originalText = button.textContent;
  button.disabled = true;
  button.classList.add("loading-button");
  button.textContent = loadingText;

  try {
    await action();
  } finally {
    button.textContent = originalText;
    button.classList.remove("loading-button");
    button.disabled = false;
  }
}

async function loadStudents() {
  const studentSnapshot = await getDocs(collection(db, "students"));
  attendanceDaysByKey.clear();

  allStudents = studentSnapshot.docs.map(docSnap => {
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

async function exportMissedDetentionEventsReport() {
  await hydrateAttendanceDaysForMissedDetentionReport();
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
      head: [["Late Date", "Detention Day", "Surname", "Given Name", "Year", "Roll Class", "Detention Date", "Attendance At School", "Outcome", "Missed Count"]],
      body: rows.map(row => [
        row.lateDate,
        row.day,
        row.surname,
        row.givenName,
        row.yearGroup,
        row.rollClass,
        row.detentionDate,
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

async function exportMissedDetentionNoticePdf() {
  await hydrateAttendanceDaysForMissedDetentionReport();
  const rows = buildMissedDetentionNoticeRows();

  if (rows.length === 0) {
    alert("No missed detention records available to export.");
    return;
  }

  const date = getLocalDateString();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 20;
  const maxTextWidth = pageWidth - (marginX * 2);
  const noticeText = getMissedDetentionNoticeText();

  rows.forEach((student, index) => {
    if (index > 0) {
      doc.addPage();
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text(student.fullName, marginX, 28);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text(`Year ${student.yearGroup || "-"}    Roll Class: ${student.rollClass || "-"}`, marginX, 38);

    doc.setFontSize(11);
    const lines = doc.splitTextToSize(noticeText, maxTextWidth);
    doc.text(lines, marginX, 55, { lineHeightFactor: 1.35 });
  });

  doc.save(`missed-detention-notices-${date}.pdf`);
}

async function hydrateAttendanceDaysForMissedDetentionReport() {
  const pairs = [];

  allStudents.forEach(student => {
    const activeDetention = student.activeDetention;
    if (!activeDetention || activeDetention.status !== "open") {
      return;
    }

    const eventDate = activeDetention.pendingAttendanceCheckDate || activeDetention.scheduledForDate;
    if (!eventDate) {
      return;
    }

    const key = `${student.studentId}_${eventDate}`;
    if (!attendanceDaysByKey.has(key)) {
      pairs.push({ studentId: student.studentId, date: eventDate });
    }
  });

  if (pairs.length === 0) {
    return;
  }

  try {
    const response = await fetch(ATTENDANCE_DAY_LOOKUP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ pairs })
    });
    const data = await response.json();
    if (!response.ok || data.status !== "success") {
      throw new Error(data.message || "Attendance lookup failed.");
    }

    Object.entries(data.records || {}).forEach(([key, value]) => {
      attendanceDaysByKey.set(key, value);
    });
  } catch (err) {
    console.error("Failed to load attendance-day records for reports", err);
  }
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

function getLocalDateString() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find(part => part.type === "year")?.value || "";
  const month = parts.find(part => part.type === "month")?.value || "";
  const day = parts.find(part => part.type === "day")?.value || "";
  return `${year}-${month}-${day}`;
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
      studentId: student.studentId,
      lateDate: entry.lateDate || '',
      day: formatWeekday(entry.scheduledForDate || entry.date || ''),
      surname: student.surname,
      givenName: student.givenName,
      yearGroup: student.yearGroup || '',
      rollClass: student.rollClass,
      detentionDate: entry.scheduledForDate || entry.date || '',
      attendanceAtSchool: getAttendanceAtSchoolLabel(entry),
      outcomeLabel: getMissedDetentionOutcomeLabel(entry),
      missedCount: index + 1
    })))
    .sort((a, b) =>
      compareYearGroups(a.yearGroup, b.yearGroup) ||
      a.surname.localeCompare(b.surname) ||
      a.givenName.localeCompare(b.givenName) ||
      String(a.detentionDate).localeCompare(String(b.detentionDate))
    );
}

function buildMissedDetentionNoticeRows() {
  const studentsById = new Map();

  buildMissedDetentionRows().forEach(row => {
    const studentId = row.studentId;
    if (!studentId || studentsById.has(studentId)) {
      return;
    }

    studentsById.set(studentId, {
      fullName: formatStudentFullName(row.givenName, row.surname),
      yearGroup: row.yearGroup || "",
      rollClass: row.rollClass || ""
    });
  });

  return [...studentsById.values()];
}

function getMissedDetentionNoticeText() {
  return [
    "This week you arrived to school late (after roll call) and did not bring a note. You had a detention scheduled, but did not attend. Please attend the detention room at SECOND BREAK TODAY (1:15-1:30), in the appropriate room below:",
    "",
    "Year 7 in D19",
    "Year 8 in D20",
    "Year 9 in A6",
    "Year 10 in A7",
    "Year 11 in A8",
    "Year 12 in A9",
    "",
    "If you refuse to attend a detention for your late arrival to school, you may receive an after school detention.",
    "",
    "If you believe this detention is an error, you must still attend the detention room and talk to the teacher on supervision."
  ].join("\n");
}

function formatStudentFullName(givenName, surname) {
  return [givenName, surname].filter(Boolean).join(" ").trim() || "Student";
}

function compareYearGroups(a, b) {
  const numericA = Number.parseInt(a, 10);
  const numericB = Number.parseInt(b, 10);
  const bothNumeric = !Number.isNaN(numericA) && !Number.isNaN(numericB);

  if (bothNumeric && numericA !== numericB) {
    return numericA - numericB;
  }

  return String(a || "").localeCompare(String(b || ""));
}

function getMissedDetentionHistory(student) {
  const activeDetention = student.activeDetention;
  if (!activeDetention || activeDetention.status !== "open") {
    return [];
  }

  const history = Array.isArray(student.detentionHistory)
    ? student.detentionHistory
    : [];
  const mostRecentServedIndex = findMostRecentServedDetentionIndex(history);
  const unresolvedHistory = history.slice(mostRecentServedIndex + 1);
  const activeLateDate = activeDetention.createdFromLateDate || "";
  const skippedDetentions = unresolvedHistory.filter(entry => {
    if (entry.outcome !== "missed_while_present") {
      return false;
    }

    if (activeLateDate && entry.lateDate && entry.lateDate !== activeLateDate) {
      return false;
    }

    return true;
  });

  const pendingOrDerivedEntry = buildCurrentMissedDetentionEntry(student);
  const extraEntries = pendingOrDerivedEntry?.outcome === "missed_while_present"
    ? [pendingOrDerivedEntry]
    : [];

  return [...skippedDetentions, ...extraEntries].sort((a, b) =>
    String(a.date || a.scheduledForDate || '').localeCompare(String(b.date || b.scheduledForDate || ''))
  );
}

function findMostRecentServedDetentionIndex(history) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.outcome === "served") {
      return index;
    }
  }

  return -1;
}

function buildPendingAttendanceEntry(student) {
  const pendingDate = student.activeDetention?.pendingAttendanceCheckDate || "";
  const attendanceDay = attendanceDaysByKey.get(`${student.studentId}_${pendingDate}`);

  if (attendanceDay?.hasFullDayCoverage) {
    return {
      date: pendingDate,
      lateDate: student.activeDetention?.createdFromLateDate || "",
      scheduledForDate: student.activeDetention?.scheduledForDate || pendingDate,
      outcome: attendanceDay.presentAtSchool ? "missed_while_present" : "absent_from_school"
    };
  }

  return {
    date: pendingDate,
    lateDate: student.activeDetention?.createdFromLateDate || "",
    scheduledForDate: student.activeDetention?.scheduledForDate || pendingDate,
    outcome: "pending_attendance_check"
  };
}

function buildCurrentMissedDetentionEntry(student) {
  const activeDetention = student.activeDetention;
  if (!activeDetention || activeDetention.status !== "open") {
    return null;
  }

  const pendingDate = activeDetention.pendingAttendanceCheckDate || "";
  const scheduledDate = activeDetention.scheduledForDate || "";
  const eventDate = pendingDate || scheduledDate;
  if (!eventDate) {
    return null;
  }

  const today = getLocalDateString();
  const isExplicitlyPending = Boolean(pendingDate);
  const isOverdueDetention = !isExplicitlyPending && scheduledDate < today;
  if (!isExplicitlyPending && !isOverdueDetention) {
    return null;
  }

  const history = Array.isArray(student.detentionHistory) ? student.detentionHistory : [];
  const alreadyRecorded = history.some(entry =>
    (entry.outcome === "missed_while_present" || entry.outcome === "absent_from_school")
    && (entry.date === eventDate || entry.scheduledForDate === eventDate)
  );
  if (alreadyRecorded) {
    return null;
  }

  return buildPendingAttendanceEntry({
    ...student,
    activeDetention: {
      ...activeDetention,
      pendingAttendanceCheckDate: eventDate
    }
  });
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
