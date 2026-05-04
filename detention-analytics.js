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

import * as XLSX from 'https://cdn.sheetjs.com/xlsx-latest/package/xlsx.mjs';

const jsPDF = window.jspdf.jsPDF;

const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const content = document.getElementById("content");
const rangePreset = document.getElementById("range-preset");
const startDateInput = document.getElementById("start-date");
const endDateInput = document.getElementById("end-date");
const yearFilter = document.getElementById("year-filter");
const refreshBtn = document.getElementById("refresh-analytics");
const exportPdfBtn = document.getElementById("export-analytics-pdf");
const exportExcelBtn = document.getElementById("export-analytics-excel");
const statusText = document.getElementById("analytics-status");
const summaryCards = document.getElementById("summary-cards");
const dailySummaryBody = document.getElementById("daily-summary-body");
const studentSummaryBody = document.getElementById("student-summary-body");

let allStudents = [];
let analytics = buildEmptyAnalytics();

loginBtn.onclick = async () => {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    alert("Login failed");
    console.error(err);
  }
};

logoutBtn.onclick = () => signOut(auth);

onAuthStateChanged(auth, async user => {
  if (user) {
    userInfo.textContent = `Signed in as: ${user.displayName} (${user.email})`;
    loginBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";
    content.style.display = "block";
    initializeDateRange();
    await loadStudents();
    renderYearFilterOptions();
    updateAnalytics();
  } else {
    userInfo.textContent = "";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    content.style.display = "none";
  }
});

rangePreset.addEventListener("change", () => {
  if (rangePreset.value !== "custom") {
    applyPresetDateRange(rangePreset.value);
  }
  updateAnalytics();
});

[startDateInput, endDateInput, yearFilter].forEach(input => {
  input.addEventListener("change", () => {
    if (input === startDateInput || input === endDateInput) {
      rangePreset.value = "custom";
    }
    updateAnalytics();
  });
});

refreshBtn.addEventListener("click", async () => {
  await loadStudents();
  renderYearFilterOptions();
  updateAnalytics();
});

exportPdfBtn.addEventListener("click", exportPdf);
exportExcelBtn.addEventListener("click", exportExcel);

window.addEventListener("resize", () => renderCharts(analytics));

async function loadStudents() {
  statusText.textContent = "Loading student records...";
  const snapshot = await getDocs(collection(db, "students"));

  allStudents = snapshot.docs.map(docSnap => {
    const data = docSnap.data();
    return {
      studentId: docSnap.id,
      givenName: data.givenName || "",
      surname: data.surname || "",
      rollClass: data.rollClass || "",
      yearGroup: resolveYearGroup(data),
      lateCount: data.lateCount || data.truancyCount || 0,
      lateArrivals: Array.isArray(data.lateArrivals || data.truancies) ? (data.lateArrivals || data.truancies) : [],
      detentionsServed: data.detentionsServed || 0,
      detentionHistory: Array.isArray(data.detentionHistory) ? data.detentionHistory : [],
      activeDetention: data.activeDetention || null,
      escalated: !!data.escalated
    };
  });
}

function initializeDateRange() {
  if (startDateInput.value && endDateInput.value) return;
  applyPresetDateRange(rangePreset.value || "week");
}

function applyPresetDateRange(preset) {
  const today = parseDate(getLocalDateString());
  let start = new Date(today);
  const end = new Date(today);

  if (preset === "today") {
    start = new Date(today);
  } else if (preset === "term") {
    start = new Date(today.getFullYear(), today.getMonth() - 2, today.getDate());
  } else {
    const day = today.getDay() || 7;
    start.setDate(today.getDate() - day + 1);
  }

  startDateInput.value = toDateString(start);
  endDateInput.value = toDateString(end);
}

function renderYearFilterOptions() {
  const currentValue = yearFilter.value;
  const years = [...new Set(allStudents.map(student => student.yearGroup).filter(Boolean))]
    .sort(compareYearGroups);

  yearFilter.innerHTML = '<option value="">All Year Groups</option>'
    + years.map(year => `<option value="${escapeHtml(year)}">${escapeHtml(year)}</option>`).join("");

  if (years.includes(currentValue)) {
    yearFilter.value = currentValue;
  }
}

function updateAnalytics() {
  const startDate = startDateInput.value;
  const endDate = endDateInput.value;
  const selectedYear = yearFilter.value;

  if (!startDate || !endDate || startDate > endDate) {
    statusText.textContent = "Choose a valid date range to view analytics.";
    analytics = buildEmptyAnalytics();
    renderAnalytics(analytics);
    return;
  }

  const filteredStudents = allStudents.filter(student => !selectedYear || student.yearGroup === selectedYear);
  analytics = buildAnalytics(filteredStudents, startDate, endDate);
  renderAnalytics(analytics);
  statusText.textContent = `${filteredStudents.length} student record(s) analysed from ${formatDisplayDate(startDate)} to ${formatDisplayDate(endDate)}.`;
}

function buildAnalytics(students, startDate, endDate) {
  const dailyMap = buildDailyMap(startDate, endDate);
  const attempts = [];
  const lateArrivalRows = [];

  students.forEach(student => {
    student.lateArrivals.forEach(arrival => {
      if (!arrival?.date || !dateInRange(arrival.date, startDate, endDate)) return;
      const day = ensureDailyRow(dailyMap, arrival.date);
      day.lateArrivals += 1;
      lateArrivalRows.push({
        date: arrival.date,
        studentId: student.studentId,
        studentName: formatStudentName(student),
        yearGroup: student.yearGroup,
        rollClass: student.rollClass,
        arrivalTime: arrival.arrivalTime || "",
        minutesLate: arrival.minutesLate ?? ""
      });
    });

    attempts.push(...buildStudentAttempts(student, startDate, endDate));
  });

  attempts.forEach(attempt => {
    const day = ensureDailyRow(dailyMap, attempt.scheduledForDate);
    day.scheduled += 1;
    day[attempt.sourceType] += 1;

    if (attempt.outcome === "served") day.served += 1;
    if (attempt.outcome === "missed_while_present") day.missedWhilePresent += 1;
    if (attempt.outcome === "absent_from_school") day.absentFromSchool += 1;
    if (attempt.outcome === "open" || attempt.outcome === "pending_attendance_check") day.openOrPending += 1;
  });

  const dailyRows = [...dailyMap.values()]
    .filter(row => dateInRange(row.date, startDate, endDate))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(row => ({
      ...row,
      completionRate: row.scheduled ? row.served / row.scheduled : 0,
      avoidanceRate: row.scheduled ? row.missedWhilePresent / row.scheduled : 0
    }));

  const studentRows = buildStudentRows(students, attempts, startDate, endDate);
  const yearRows = buildYearRows(attempts);
  const repeatBuckets = buildRepeatBuckets(studentRows);
  const totals = buildTotals(dailyRows, studentRows);

  return {
    dailyRows,
    studentRows,
    yearRows,
    repeatBuckets,
    lateArrivalRows,
    totals,
    startDate,
    endDate
  };
}

function buildDailyMap(startDate, endDate) {
  const rows = new Map();
  let cursor = parseDate(startDate);
  const end = parseDate(endDate);

  while (cursor <= end) {
    rows.set(toDateString(cursor), createDailyRow(toDateString(cursor)));
    cursor.setDate(cursor.getDate() + 1);
  }

  return rows;
}

function ensureDailyRow(rows, date) {
  if (!rows.has(date)) {
    rows.set(date, createDailyRow(date));
  }
  return rows.get(date);
}

function createDailyRow(date) {
  return {
    date,
    scheduled: 0,
    served: 0,
    missedWhilePresent: 0,
    absentFromSchool: 0,
    openOrPending: 0,
    lateArrivals: 0,
    newAttempts: 0,
    rolledOver: 0
  };
}

function buildStudentAttempts(student, startDate, endDate) {
  const attempts = [];
  const history = [...student.detentionHistory]
    .filter(entry => entry && (entry.scheduledForDate || entry.date))
    .sort((a, b) => String(a.scheduledForDate || a.date).localeCompare(String(b.scheduledForDate || b.date)) || String(a.date || "").localeCompare(String(b.date || "")));

  const missedByLateDate = new Map();

  history.forEach(entry => {
    const scheduledForDate = entry.scheduledForDate || entry.date;
    if (!scheduledForDate) return;

    const lateDate = entry.lateDate || entry.createdFromLateDate || "";
    const hadPreviousMiss = lateDate ? (missedByLateDate.get(lateDate) || 0) > 0 : false;
    const sourceType = hadPreviousMiss ? "rolledOver" : "newAttempts";

    if (dateInRange(scheduledForDate, startDate, endDate)) {
      attempts.push(buildAttemptRow(student, {
        scheduledForDate,
        lateDate,
        outcomeDate: entry.date || scheduledForDate,
        outcome: normalizeOutcome(entry.outcome),
        sourceType,
        status: "history"
      }));
    }

    if (entry.outcome === "missed_while_present" && lateDate) {
      missedByLateDate.set(lateDate, (missedByLateDate.get(lateDate) || 0) + 1);
    }
  });

  const active = student.activeDetention;
  if (active?.status === "open" && active.scheduledForDate && dateInRange(active.scheduledForDate, startDate, endDate)) {
    const lateDate = active.createdFromLateDate || "";
    const missedCount = Number(active.missedWhilePresentCount || 0);
    attempts.push(buildAttemptRow(student, {
      scheduledForDate: active.scheduledForDate,
      lateDate,
      outcomeDate: active.pendingAttendanceCheckDate || "",
      outcome: active.pendingAttendanceCheckDate ? "pending_attendance_check" : "open",
      sourceType: missedCount > 0 || (lateDate && (missedByLateDate.get(lateDate) || 0) > 0) ? "rolledOver" : "newAttempts",
      status: "active"
    }));
  }

  return attempts;
}

function buildAttemptRow(student, values) {
  return {
    studentId: student.studentId,
    studentName: formatStudentName(student),
    yearGroup: student.yearGroup || "",
    rollClass: student.rollClass || "",
    lateCount: student.lateCount || 0,
    escalated: student.escalated,
    ...values
  };
}

function buildStudentRows(students, attempts) {
  const attemptsByStudent = new Map();
  attempts.forEach(attempt => {
    if (!attemptsByStudent.has(attempt.studentId)) {
      attemptsByStudent.set(attempt.studentId, []);
    }
    attemptsByStudent.get(attempt.studentId).push(attempt);
  });

  return students
    .map(student => {
      const rows = attemptsByStudent.get(student.studentId) || [];
      return {
        studentId: student.studentId,
        studentName: formatStudentName(student),
        yearGroup: student.yearGroup || "",
        rollClass: student.rollClass || "",
        lateCount: student.lateCount || 0,
        scheduled: rows.length,
        served: rows.filter(row => row.outcome === "served").length,
        missedWhilePresent: rows.filter(row => row.outcome === "missed_while_present").length,
        currentDetention: student.activeDetention?.scheduledForDate || "",
        escalated: student.escalated ? "Yes" : "No"
      };
    })
    .filter(row => row.scheduled > 0 || row.currentDetention)
    .sort((a, b) => b.scheduled - a.scheduled || b.missedWhilePresent - a.missedWhilePresent || a.studentName.localeCompare(b.studentName));
}

function buildYearRows(attempts) {
  const rows = new Map();
  attempts.forEach(attempt => {
    const year = attempt.yearGroup || "Unknown";
    if (!rows.has(year)) {
      rows.set(year, { yearGroup: year, scheduled: 0, served: 0, missedWhilePresent: 0 });
    }
    const row = rows.get(year);
    row.scheduled += 1;
    if (attempt.outcome === "served") row.served += 1;
    if (attempt.outcome === "missed_while_present") row.missedWhilePresent += 1;
  });

  return [...rows.values()].sort((a, b) => compareYearGroups(a.yearGroup, b.yearGroup));
}

function buildRepeatBuckets(studentRows) {
  return [
    { label: "1", count: studentRows.filter(row => row.scheduled === 1).length },
    { label: "2", count: studentRows.filter(row => row.scheduled === 2).length },
    { label: "3", count: studentRows.filter(row => row.scheduled === 3).length },
    { label: "4+", count: studentRows.filter(row => row.scheduled >= 4).length }
  ];
}

function buildTotals(dailyRows, studentRows) {
  const scheduled = sum(dailyRows, "scheduled");
  const served = sum(dailyRows, "served");
  const missedWhilePresent = sum(dailyRows, "missedWhilePresent");
  const absentFromSchool = sum(dailyRows, "absentFromSchool");
  const openOrPending = sum(dailyRows, "openOrPending");
  const uniqueStudents = studentRows.filter(row => row.scheduled > 0).length;
  const repeatStudents = studentRows.filter(row => row.scheduled > 1).length;

  return {
    scheduled,
    served,
    missedWhilePresent,
    absentFromSchool,
    openOrPending,
    lateArrivals: sum(dailyRows, "lateArrivals"),
    newAttempts: sum(dailyRows, "newAttempts"),
    rolledOver: sum(dailyRows, "rolledOver"),
    uniqueStudents,
    repeatStudents,
    completionRate: scheduled ? served / scheduled : 0,
    avoidanceRate: scheduled ? missedWhilePresent / scheduled : 0
  };
}

function renderAnalytics(data) {
  renderSummaryCards(data.totals);
  renderDailyTable(data.dailyRows);
  renderStudentTable(data.studentRows);
  renderCharts(data);
}

function renderSummaryCards(totals) {
  const cards = [
    ["Scheduled", totals.scheduled, "Total detention attempts in range"],
    ["Served", totals.served, `${formatPercent(totals.completionRate)} completion rate`],
    ["Missed", totals.missedWhilePresent, `${formatPercent(totals.avoidanceRate)} missed while present`],
    ["Late Arrivals", totals.lateArrivals, "Unjustified roll-call late records"],
    ["Unique Students", totals.uniqueStudents, `${totals.repeatStudents} repeat student(s)`],
    ["Rolled Over", totals.rolledOver, "Attempts after a previous missed detention"]
  ];

  summaryCards.innerHTML = cards.map(([label, value, detail]) => `
    <article class="analytics-stat-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <p>${detail}</p>
    </article>
  `).join("");
}

function renderDailyTable(rows) {
  dailySummaryBody.innerHTML = rows.map(row => `
    <tr>
      <td>${formatDisplayDate(row.date)}</td>
      <td>${row.scheduled}</td>
      <td>${row.served}</td>
      <td>${row.missedWhilePresent}</td>
      <td>${row.absentFromSchool}</td>
      <td>${row.openOrPending}</td>
      <td>${row.lateArrivals}</td>
      <td>${row.newAttempts}</td>
      <td>${row.rolledOver}</td>
      <td>${formatPercent(row.completionRate)}</td>
    </tr>
  `).join("") || '<tr><td colspan="10">No detention activity found for this range.</td></tr>';
}

function renderStudentTable(rows) {
  studentSummaryBody.innerHTML = rows.slice(0, 50).map(row => `
    <tr>
      <td>${escapeHtml(row.studentName)}</td>
      <td>${escapeHtml(row.yearGroup || "-")}</td>
      <td>${escapeHtml(row.rollClass || "-")}</td>
      <td>${row.lateCount}</td>
      <td>${row.scheduled}</td>
      <td>${row.served}</td>
      <td>${row.missedWhilePresent}</td>
      <td>${row.currentDetention ? formatDisplayDate(row.currentDetention) : "None"}</td>
      <td>${row.escalated}</td>
    </tr>
  `).join("") || '<tr><td colspan="9">No student detention activity found for this range.</td></tr>';
}

function renderCharts(data) {
  drawStackedBarChart("daily-outcomes-chart", data.dailyRows, [
    { key: "served", label: "Served", color: "#1f9d55" },
    { key: "missedWhilePresent", label: "Missed", color: "#c0392b" },
    { key: "absentFromSchool", label: "Absent", color: "#f39c12" },
    { key: "openOrPending", label: "Open", color: "#5f6f82" }
  ], row => formatShortDate(row.date));

  drawGroupedBarChart("source-chart", data.dailyRows, [
    { key: "newAttempts", label: "New", color: "#2980b9" },
    { key: "rolledOver", label: "Rollover", color: "#8e5a2a" }
  ], row => formatShortDate(row.date));

  drawSimpleBarChart("repeat-chart", data.repeatBuckets, "count", row => row.label, "#34495e");

  drawGroupedBarChart("year-chart", data.yearRows, [
    { key: "scheduled", label: "Scheduled", color: "#2980b9" },
    { key: "served", label: "Served", color: "#1f9d55" },
    { key: "missedWhilePresent", label: "Missed", color: "#c0392b" }
  ], row => row.yearGroup);
}

function drawStackedBarChart(canvasId, rows, series, labelForRow) {
  const canvas = prepareCanvas(canvasId);
  if (!canvas) return;
  const { ctx, width, height } = canvas;
  drawChartFrame(ctx, width, height, series);

  const maxValue = Math.max(1, ...rows.map(row => series.reduce((total, item) => total + row[item.key], 0)));
  const chart = getChartArea(width, height);
  const barWidth = rows.length ? Math.max(10, chart.width / rows.length * 0.58) : 10;

  rows.forEach((row, index) => {
    const x = chart.left + (index + 0.5) * (chart.width / Math.max(rows.length, 1)) - barWidth / 2;
    let y = chart.bottom;
    series.forEach(item => {
      const barHeight = (row[item.key] / maxValue) * chart.height;
      ctx.fillStyle = item.color;
      ctx.fillRect(x, y - barHeight, barWidth, barHeight);
      y -= barHeight;
    });
    drawXAxisLabel(ctx, labelForRow(row), x + barWidth / 2, chart.bottom + 16, rows.length);
  });

  drawYAxis(ctx, chart, maxValue);
}

function drawGroupedBarChart(canvasId, rows, series, labelForRow) {
  const canvas = prepareCanvas(canvasId);
  if (!canvas) return;
  const { ctx, width, height } = canvas;
  drawChartFrame(ctx, width, height, series);

  const maxValue = Math.max(1, ...rows.flatMap(row => series.map(item => row[item.key])));
  const chart = getChartArea(width, height);
  const groupWidth = rows.length ? chart.width / rows.length : chart.width;
  const barWidth = Math.max(7, Math.min(24, groupWidth / (series.length + 1.4)));

  rows.forEach((row, rowIndex) => {
    const groupCenter = chart.left + (rowIndex + 0.5) * groupWidth;
    const startX = groupCenter - (series.length * barWidth) / 2;
    series.forEach((item, seriesIndex) => {
      const value = row[item.key];
      const barHeight = (value / maxValue) * chart.height;
      ctx.fillStyle = item.color;
      ctx.fillRect(startX + seriesIndex * barWidth, chart.bottom - barHeight, barWidth * 0.82, barHeight);
    });
    drawXAxisLabel(ctx, labelForRow(row), groupCenter, chart.bottom + 16, rows.length);
  });

  drawYAxis(ctx, chart, maxValue);
}

function drawSimpleBarChart(canvasId, rows, valueKey, labelForRow, color) {
  drawGroupedBarChart(canvasId, rows, [{ key: valueKey, label: "Students", color }], labelForRow);
}

function prepareCanvas(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const parentWidth = canvas.parentElement.clientWidth || 640;
  const cssHeight = Number(canvas.getAttribute("height")) || 280;
  const scale = window.devicePixelRatio || 1;

  canvas.style.width = "100%";
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.floor(parentWidth * scale);
  canvas.height = Math.floor(cssHeight * scale);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, parentWidth, cssHeight);
  ctx.font = "12px Segoe UI, sans-serif";
  ctx.fillStyle = "#2c3e50";

  return { ctx, width: parentWidth, height: cssHeight };
}

function drawChartFrame(ctx, width, height, series) {
  const chart = getChartArea(width, height);
  ctx.strokeStyle = "#d6e0ea";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(chart.left, chart.top);
  ctx.lineTo(chart.left, chart.bottom);
  ctx.lineTo(chart.right, chart.bottom);
  ctx.stroke();

  let legendX = chart.left;
  series.forEach(item => {
    ctx.fillStyle = item.color;
    ctx.fillRect(legendX, 12, 10, 10);
    ctx.fillStyle = "#435466";
    ctx.fillText(item.label, legendX + 14, 21);
    legendX += ctx.measureText(item.label).width + 38;
  });
}

function drawYAxis(ctx, chart, maxValue) {
  ctx.fillStyle = "#6b7c8f";
  ctx.textAlign = "right";
  ctx.fillText(String(Math.ceil(maxValue)), chart.left - 8, chart.top + 4);
  ctx.fillText("0", chart.left - 8, chart.bottom + 4);
  ctx.textAlign = "left";
}

function drawXAxisLabel(ctx, label, x, y, rowCount) {
  if (rowCount > 12 && !isImportantTick(label)) return;
  ctx.save();
  ctx.fillStyle = "#6b7c8f";
  ctx.textAlign = "center";
  ctx.translate(x, y);
  if (rowCount > 8) ctx.rotate(-Math.PI / 5);
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

function getChartArea(width, height) {
  return {
    left: 42,
    right: width - 18,
    top: 34,
    bottom: height - 42,
    width: Math.max(10, width - 60),
    height: Math.max(10, height - 76)
  };
}

function exportPdf() {
  const doc = new jsPDF({ orientation: "landscape" });
  const title = `Detention Analytics (${analytics.startDate || ""} to ${analytics.endDate || ""})`;
  doc.text(title, 14, 15);
  doc.text(`Scheduled: ${analytics.totals.scheduled} | Served: ${analytics.totals.served} | Missed: ${analytics.totals.missedWhilePresent} | Unique students: ${analytics.totals.uniqueStudents}`, 14, 23);

  doc.autoTable({
    startY: 30,
    head: [["Date", "Scheduled", "Served", "Missed Present", "Absent", "Open/Pending", "Late Arrivals", "New", "Rollover", "Completion"]],
    body: analytics.dailyRows.map(row => [
      row.date,
      row.scheduled,
      row.served,
      row.missedWhilePresent,
      row.absentFromSchool,
      row.openOrPending,
      row.lateArrivals,
      row.newAttempts,
      row.rolledOver,
      formatPercent(row.completionRate)
    ]),
    styles: { fontSize: 8 }
  });

  doc.addPage();
  doc.text("Repeat Students", 14, 15);
  doc.autoTable({
    startY: 22,
    head: [["Student", "Year", "Roll Class", "Late Count", "Scheduled", "Served", "Missed Present", "Current Detention", "Escalated"]],
    body: analytics.studentRows.map(row => [row.studentName, row.yearGroup, row.rollClass, row.lateCount, row.scheduled, row.served, row.missedWhilePresent, row.currentDetention || "None", row.escalated]),
    styles: { fontSize: 8 }
  });

  doc.save(`detention_analytics_${getLocalDateString()}.pdf`);
}

function exportExcel() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(analytics.dailyRows.map(row => ({
    Date: row.date,
    Scheduled: row.scheduled,
    Served: row.served,
    "Missed While Present": row.missedWhilePresent,
    "Absent From School": row.absentFromSchool,
    "Open Or Pending": row.openOrPending,
    "Late Arrivals": row.lateArrivals,
    "New Attempts": row.newAttempts,
    "Rolled Over": row.rolledOver,
    "Completion Rate": formatPercent(row.completionRate)
  }))), "Daily Summary");

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(analytics.studentRows.map(row => ({
    Student: row.studentName,
    Year: row.yearGroup,
    "Roll Class": row.rollClass,
    "Late Count": row.lateCount,
    "Scheduled Attempts": row.scheduled,
    Served: row.served,
    "Missed While Present": row.missedWhilePresent,
    "Current Detention": row.currentDetention || "None",
    Escalated: row.escalated
  }))), "Student Breakdown");

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(analytics.yearRows.map(row => ({
    Year: row.yearGroup,
    Scheduled: row.scheduled,
    Served: row.served,
    "Missed While Present": row.missedWhilePresent
  }))), "Year Groups");

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(analytics.lateArrivalRows.map(row => ({
    Date: row.date,
    Student: row.studentName,
    Year: row.yearGroup,
    "Roll Class": row.rollClass,
    "Arrival Time": row.arrivalTime,
    "Minutes Late": row.minutesLate
  }))), "Late Arrivals");

  XLSX.writeFile(workbook, `detention_analytics_${getLocalDateString()}.xlsx`);
}

function buildEmptyAnalytics() {
  return {
    dailyRows: [],
    studentRows: [],
    yearRows: [],
    repeatBuckets: [],
    lateArrivalRows: [],
    totals: {
      scheduled: 0,
      served: 0,
      missedWhilePresent: 0,
      absentFromSchool: 0,
      openOrPending: 0,
      lateArrivals: 0,
      newAttempts: 0,
      rolledOver: 0,
      uniqueStudents: 0,
      repeatStudents: 0,
      completionRate: 0,
      avoidanceRate: 0
    },
    startDate: "",
    endDate: ""
  };
}

function normalizeOutcome(outcome) {
  if (outcome === "missed_while_present") return "missed_while_present";
  if (outcome === "absent_from_school") return "absent_from_school";
  if (outcome === "pending_attendance_check") return "pending_attendance_check";
  return outcome === "served" ? "served" : "open";
}

function dateInRange(date, startDate, endDate) {
  return date >= startDate && date <= endDate;
}

function parseDate(dateString) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function toDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getLocalDateString() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(new Date());
  return `${parts.find(part => part.type === "year")?.value}-${parts.find(part => part.type === "month")?.value}-${parts.find(part => part.type === "day")?.value}`;
}

function formatDisplayDate(dateString) {
  if (!dateString) return "";
  const date = parseDate(dateString);
  return date.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

function formatShortDate(dateString) {
  const date = parseDate(dateString);
  return date.toLocaleDateString("en-AU", { day: "2-digit", month: "short" });
}

function formatPercent(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function formatStudentName(student) {
  return [student.surname, student.givenName].filter(Boolean).join(", ") || student.studentId;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

function getYearGroup(rollClass) {
  const match = String(rollClass || "").match(/\d+/);
  return match ? match[0] : "";
}

function resolveYearGroup(student) {
  const explicitYear = normalizeYearGroupValue(student.yearGroup);
  if (explicitYear) return explicitYear;

  const lateArrivals = student.lateArrivals || student.truancies || [];
  const lateYear = Array.isArray(lateArrivals)
    ? lateArrivals.map(entry => normalizeYearGroupValue(entry.yearGroup)).find(Boolean)
    : "";
  if (lateYear) return lateYear;

  return getYearGroup(student.rollClass || "");
}

function normalizeYearGroupValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.toUpperCase() === "SRC") return "SRC";
  if (text.endsWith(".0")) return text.slice(0, -2);
  const digits = text.match(/\d+/);
  return digits ? digits[0] : text;
}

function compareYearGroups(a, b) {
  const numericA = Number.parseInt(a, 10);
  const numericB = Number.parseInt(b, 10);
  const bothNumeric = !Number.isNaN(numericA) && !Number.isNaN(numericB);
  if (bothNumeric && numericA !== numericB) return numericA - numericB;
  return String(a || "").localeCompare(String(b || ""));
}

function isImportantTick(label) {
  return /01|Mon|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/.test(label);
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}
