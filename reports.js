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
const generateMissedDetentionPdfBtn = document.getElementById("generate-missed-detention-pdf");

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
  } else {
    userInfo.textContent = "";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    content.style.display = "none";
  }
});

generateMissedDetentionPdfBtn.addEventListener("click", async () => {
  await runWithButtonLoading(generateMissedDetentionPdfBtn, "Generating...", exportMissedDetentionNoticePdf);
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
    activeDetention: student.activeDetention?.scheduledForDate || 'None'
  }));

  if (exportFormat.value === "pdf") {
    const doc = new jsPDF();
    doc.text("Attendance Assistant Summary Report", 14, 15);
    doc.autoTable({
      startY: 22,
      head: [["Surname", "Given Name", "Roll Class", "Late Count", "Detentions Served", "Active Detention"]],
      body: rows.map(row => [row.surname, row.givenName, row.rollClass, row.lateCount, row.detentionsServed, row.activeDetention]),
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

function exportAllStudentsReport() {
  const date = getFormattedDate();
  const rows = allStudents.map(student => ({
    studentId: student.studentId,
    surname: student.surname,
    givenName: student.givenName,
    yearGroup: student.yearGroup || '',
    rollClass: student.rollClass,
    lateCount: student.lateCount,
    unjustifiedLateArrivalDates: getUnjustifiedLateArrivalDates(student).join(', '),
    mostRecentCompletedDetention: getMostRecentCompletedDetentionDate(student) || '',
    currentActiveDetention: student.activeDetention?.scheduledForDate || ''
  }));

  if (rows.length === 0) {
    alert("No student records were found.");
    return;
  }

  if (exportFormat.value === "pdf") {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.text("All Students Register", 14, 15);
    doc.autoTable({
      startY: 22,
      head: [["Student ID", "Surname", "Given Name", "Year", "Roll Class", "Late Count", "Unjustified Late Arrival Dates", "Most Recent Completed Detention", "Active Detention"]],
      body: rows.map(row => [
        row.studentId,
        row.surname,
        row.givenName,
        row.yearGroup,
        row.rollClass,
        row.lateCount,
        row.unjustifiedLateArrivalDates,
        row.mostRecentCompletedDetention,
        row.currentActiveDetention
      ]),
      styles: { fontSize: 7 },
      columnStyles: {
        6: { cellWidth: 58 },
        7: { cellWidth: 28 }
      }
    });
    doc.save(`all_students_register_${date}.pdf`);
    return;
  }

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "All Students");
  XLSX.writeFile(workbook, `all_students_register_${date}.xlsx`);
}

async function exportHistoricMissedDetentionEventsReport() {
  await hydrateAttendanceDaysForMissedDetentionReport();
  exportMissedDetentionEventsReport({
    title: "Historic Missed Detentions Report",
    rows: buildHistoricMissedDetentionRows(),
    emptyMessage: "No historic missed detention records were found.",
    filenamePrefix: "historic_missed_detentions"
  });
}

async function exportOutstandingMissedDetentionEventsReport() {
  await hydrateAttendanceDaysForMissedDetentionReport();
  exportMissedDetentionEventsReport({
    title: "Outstanding Missed Detentions Report",
    rows: buildOutstandingMissedDetentionRows(),
    emptyMessage: "No outstanding missed detention records were found.",
    filenamePrefix: "outstanding_missed_detentions"
  });
}

function exportMissedDetentionEventsReport({ title, rows, emptyMessage, filenamePrefix }) {
  const date = getFormattedDate();

  if (rows.length === 0) {
    alert(emptyMessage);
    return;
  }

  if (exportFormat.value === "pdf") {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.text(title, 14, 15);
    doc.autoTable({
      startY: 22,
      head: [[
        "Missed Detention Date",
        "Detention Day",
        "Surname",
        "Given Name",
        "Year",
        "Roll Class",
        "Latest Late Arrival",
        "Late Arrivals",
        "Detentions Served",
        "Detentions Missed",
        "Attendance",
        "Outcome"
      ]],
      body: rows.map(row => [
        row["Missed Detention Date"],
        row["Detention Day"],
        row.Surname,
        row["Given Name"],
        row.Year,
        row["Roll Class"],
        row["Date of Most Recent Late Arrival"],
        row["Number of Late Arrivals"],
        row["Number of Late Detentions Served"],
        row["Number of Late Detentions Missed"],
        row["Attendance During Detention"],
        row.Outcome
      ]),
      styles: { fontSize: 7 }
    });
    doc.save(`${filenamePrefix}_${date}.pdf`);
    return;
  }

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Missed Detentions");
  XLSX.writeFile(workbook, `${filenamePrefix}_${date}.xlsx`);
}

async function exportMissedDetentionNoticePdf() {
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
      detentionAssignedFor: student.activeDetention?.scheduledForDate || ''
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
      head: [["Student ID", "Surname", "Given Name", "Roll Class", "Date", "Arrival Time", "Minutes Late", "Shorthand", "Description"]],
      body: historyRows.map(row => [row.studentId, row.surname, row.givenName, row.rollClass, row.date, row.arrivalTime, row.minutesLate, row.shorthand, row.description]),
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
  if (!hasOutstandingDetentionObligation(student)) {
    return 0;
  }

  return Array.isArray(student.detentionHistory)
    ? getOutstandingMissedDetentionHistory(student).length
    : 0;
}

function getUnjustifiedLateArrivalDates(student) {
  return [...student.lateArrivals]
    .filter(arrival => arrival && arrival.justified !== true)
    .map(arrival => arrival.date || '')
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function getMostRecentCompletedDetentionDate(student) {
  const servedDates = [...student.detentionHistory]
    .filter(entry => entry?.outcome === "served")
    .map(entry => entry.date || entry.scheduledForDate || '')
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));

  return servedDates[0] || '';
}

function getLatestLateArrivalDate(student) {
  return [...student.lateArrivals]
    .filter(arrival => arrival && arrival.justified !== true)
    .map(arrival => arrival.date || '')
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0] || '';
}

function getLateArrivalCount(student) {
  return getUnjustifiedLateArrivalDates(student).length || student.lateCount || 0;
}

function getDetentionsServedCount(student) {
  const historyServedCount = Array.isArray(student.detentionHistory)
    ? student.detentionHistory.filter(entry => entry?.outcome === "served").length
    : 0;
  return Math.max(historyServedCount, student.detentionsServed || 0);
}

function hasOutstandingDetentionObligation(student) {
  const activeDetention = student.activeDetention;
  if (!activeDetention || activeDetention.status !== "open") {
    return false;
  }

  const latestLateDate = getLatestLateArrivalDate(student);
  const mostRecentServedDate = getMostRecentCompletedDetentionDate(student);
  if (latestLateDate && mostRecentServedDate && mostRecentServedDate >= latestLateDate) {
    return false;
  }

  return true;
}

function buildHistoricMissedDetentionRows() {
  return buildMissedDetentionRowsFromEntries(student => getHistoricMissedDetentionHistory(student));
}

function buildOutstandingMissedDetentionRows() {
  return buildMissedDetentionRowsFromEntries(student => getOutstandingMissedDetentionHistory(student));
}

function buildMissedDetentionRowsFromEntries(resolveEntries) {
  return allStudents
    .flatMap(student => {
      const entries = resolveEntries(student);
      const detentionsMissed = getHistoricMissedDetentionHistory(student).length;
      return entries.map(entry => ({
        "Missed Detention Date": entry.scheduledForDate || entry.date || '',
        "Detention Day": formatWeekday(entry.scheduledForDate || entry.date || ''),
        Surname: student.surname,
        "Given Name": student.givenName,
        Year: student.yearGroup || '',
        "Roll Class": student.rollClass,
        "Date of Most Recent Late Arrival": getLatestLateArrivalDate(student),
        "Number of Late Arrivals": getLateArrivalCount(student),
        "Number of Late Detentions Served": getDetentionsServedCount(student),
        "Number of Late Detentions Missed": detentionsMissed,
        "Attendance During Detention": getAttendanceAtSchoolLabel(entry),
        Outcome: getMissedDetentionOutcomeLabel(entry),
        "Attendance Evidence": entry.attendanceEvidence || '',
        "Attendance Day Row Count": entry.attendanceDayRowCount ?? '',
        studentId: student.studentId,
        missedDetentionDate: entry.scheduledForDate || entry.date || '',
        day: formatWeekday(entry.scheduledForDate || entry.date || ''),
        surname: student.surname,
        givenName: student.givenName,
        yearGroup: student.yearGroup || '',
        rollClass: student.rollClass,
        mostRecentLateArrivalDate: getLatestLateArrivalDate(student),
        lateArrivalCount: getLateArrivalCount(student),
        detentionsServed: getDetentionsServedCount(student),
        detentionsMissed,
        attendanceAtSchool: getAttendanceAtSchoolLabel(entry),
        outcomeLabel: getMissedDetentionOutcomeLabel(entry),
        attendanceEvidence: entry.attendanceEvidence || '',
        attendanceDayRowCount: entry.attendanceDayRowCount ?? ''
      }));
    })
    .sort((a, b) =>
      String(a.missedDetentionDate).localeCompare(String(b.missedDetentionDate)) ||
      compareYearGroups(a.yearGroup, b.yearGroup) ||
      a.surname.localeCompare(b.surname) ||
      a.givenName.localeCompare(b.givenName)
    )
    .map(({ studentId, missedDetentionDate, day, surname, givenName, yearGroup, rollClass, mostRecentLateArrivalDate, lateArrivalCount, detentionsServed, detentionsMissed, attendanceAtSchool, outcomeLabel, attendanceEvidence, attendanceDayRowCount, ...reportRow }) => reportRow);
}

function buildMissedDetentionNoticeRows() {
  const studentsById = new Map();

  allStudents.forEach(student => {
    if (studentsById.has(student.studentId)) return;
    if (getOutstandingMissedDetentionHistory(student).length === 0) return;

    studentsById.set(student.studentId, {
      fullName: formatStudentFullName(student.givenName, student.surname),
      yearGroup: student.yearGroup || "",
      rollClass: student.rollClass || ""
    });
  });

  return [...studentsById.values()];
}

function getMissedDetentionNoticeText() {
  return [
    "This week you arrived to school late (after roll call) and did not bring a note. You had a detention scheduled, but did not attend. Please attend the detention room at FIRST BREAK TODAY (10:35 Mon / Wed / Fri or 10:25 Tue / Thur), in the appropriate room below:",
    "",
    "Stage 4 (Year 7 and Year 8) in A6",
    "Stage 5 (Year 9 and Year 10) in A7",
    "Stage 6 (Year 11 and Year 12) in A9",
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

function getHistoricMissedDetentionHistory(student) {
  const history = Array.isArray(student.detentionHistory)
    ? student.detentionHistory
    : [];

  return history.filter(entry => entry?.outcome === "missed_while_present").sort((a, b) =>
    String(a.scheduledForDate || a.date || '').localeCompare(String(b.scheduledForDate || b.date || ''))
  );
}

function getOutstandingMissedDetentionHistory(student) {
  if (!hasOutstandingDetentionObligation(student)) {
    return [];
  }

  const activeDetention = student.activeDetention;
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

  return skippedDetentions.sort((a, b) =>
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

function getAttendanceAtSchoolLabel(entry) {
  if (entry.outcome === "missed_while_present") return "Present";
  if (entry.outcome === "absent_from_school" || entry.outcome === "not_counted_absence_recorded") return "Not safely present";
  return "Pending check";
}

function getMissedDetentionOutcomeLabel(entry) {
  if (entry.outcome === "missed_while_present") return "Missed detention while present";
  if (entry.outcome === "absent_from_school") return "Missed detention while absent from school";
  if (entry.outcome === "not_counted_absence_recorded") return "Not counted because an absence row was recorded";
  return "Missed detention awaiting attendance confirmation";
}

function formatWeekday(dateText) {
  const match = String(dateText || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.toLocaleDateString('en-AU', { weekday: 'long' });
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
