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
  
  // Elements
  const loginBtn = document.getElementById("login-btn");
  const logoutBtn = document.getElementById("logout-btn");
  const userInfo = document.getElementById("user-info");
  const content = document.getElementById("content");
  const generateBtn = document.getElementById("generate-report");
  
  // Auth
  loginBtn.onclick = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider).catch(err => {
      alert("Login failed");
      console.error(err);
    });
  };
  
  logoutBtn.onclick = () => signOut(auth);
  
  onAuthStateChanged(auth, user => {
    if (user) {
      userInfo.textContent = `Signed in as: ${user.displayName} (${user.email})`;
      loginBtn.style.display = "none";
      logoutBtn.style.display = "inline-block";
      content.style.display = "block";
    } else {
      userInfo.textContent = "";
      loginBtn.style.display = "inline-block";
      logoutBtn.style.display = "none";
      content.style.display = "none";
    }
  });
  
  // Toggle buttons
  let settings = {
    content: "simple",
    sort: "roll",
    format: "pdf"
  };
  
  document.querySelectorAll(".toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const group = btn.dataset.group;
      const value = btn.dataset.value;
      settings[group] = value;
  
      document.querySelectorAll(`.toggle-btn[data-group="${group}"]`).forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
  
  // Data
  function getFormattedDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  
  async function fetchData() {
    const students = [];
    const snapshot = await getDocs(collection(db, "students"));
  
    snapshot.forEach(doc => {
      const data = doc.data();
      const latest = (data.truancies || []).sort((a, b) => new Date(b.date) - new Date(a.date))[0] || {};
  
      students.push({
        studentId: doc.id,
        surname: data.surname || '',
        givenName: data.givenName || '',
        rollClass: data.rollClass || '',
        truancyCount: data.truancyCount || 0,
        lastDate: latest.date || '-',
        detentionsServed: data.detentionsServed || 0,
        resolved: data.truancyResolved === true ? 'Yes' : data.truancyResolved === false ? 'No' : 'error'
      });
    });
  
    // Sort
    if (settings.sort === 'roll') {
      const rollOrder = ["7", "8", "9", "10", "11", "12", "SUPPORT", "SRC", "Connect Roll"];
      students.sort((a, b) => {
        const rollOrder = ["7", "8", "9", "10", "11", "12", "SUPPORT", "SRC", "Connect Roll"];
        const aKey = a.rollClass?.toUpperCase() || '';
        const bKey = b.rollClass?.toUpperCase() || '';
      
        const aIndex = rollOrder.findIndex(p => aKey.startsWith(p));
        const bIndex = rollOrder.findIndex(p => bKey.startsWith(p));
      
        if (aIndex !== bIndex) return aIndex - bIndex;
      
        // If same roll group, sort by full roll class name (e.g. 10.1 before 10.2)
        if (aKey !== bKey) return aKey.localeCompare(bKey);
      
        return a.surname.localeCompare(b.surname);
      });
      
    } else {
      students.sort((a, b) => a.surname.localeCompare(b.surname));
    }
  
    return students;
  }
  
  // Export
  generateBtn.addEventListener("click", async () => {
    const data = await fetchData();
    const date = getFormattedDate();
    const now = new Date();
    const dateTimeString = now.toLocaleString("en-AU"); // e.g. 2025-06-29 10:01
    const optionString = `${settings.content} list sorted by ${settings.sort}`;
  
    if (settings.format === "pdf") {
      const doc = new jsPDF();
      const head = settings.content === "detailed"
        ? [["Student ID", "Surname", "Given Name(s)", "Roll Class", "Late Arrival Count", "Last Late Date", "Detentions Served", "Resolved?"]]
        : [["Surname", "Given Name(s)", "Roll Class", "Late Arrival Count", "Detentions Served", "Resolved?"]];
  
      if (settings.sort === "roll") {
        const rollOrder = ["7", "8", "9", "10", "11", "12", "SUPPORT", "SRC", "Connect Roll"];
        const groups = {};
  
        data.forEach(d => {
          const rc = d.rollClass || "Unknown";
          if (!groups[rc]) groups[rc] = [];
          groups[rc].push(d);
        });
  
        const sortedRollClasses = Object.keys(groups).sort((a, b) => {
          const ai = rollOrder.findIndex(prefix => a.toUpperCase().startsWith(prefix));
          const bi = rollOrder.findIndex(prefix => b.toUpperCase().startsWith(prefix));
          return (ai !== bi ? ai - bi : a.localeCompare(b));
        });
  
        sortedRollClasses.forEach((rc, idx) => {
          const groupData = groups[rc].map(d => settings.content === "detailed"
            ? [d.studentId, d.surname, d.givenName, d.rollClass, d.truancyCount, d.lastDate, d.detentionsServed, d.resolved]
            : [d.surname, d.givenName, d.rollClass, d.truancyCount, d.detentionsServed, d.resolved]);
  
          if (idx > 0) doc.addPage();
  
          doc.setFontSize(10);
          doc.text(`Roll Class: ${rc}`, 14, 15);
  
          doc.autoTable({
            startY: 20,
            head,
            body: groupData,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [41, 128, 185] }
          });
  
          doc.setFontSize(8);
          doc.text(`Generated: ${dateTimeString}`, 14, doc.lastAutoTable.finalY + 10);
        });
  
      } else {
        doc.setFontSize(10);
        doc.text(`Student Lateness Report`, 14, 15);
        doc.setFontSize(8);
        doc.text(`Generated: ${dateTimeString}`, 14, 20);
  
        const body = data.map(d => settings.content === "detailed"
          ? [d.studentId, d.surname, d.givenName, d.rollClass, d.truancyCount, d.lastDate, d.detentionsServed, d.resolved]
          : [d.surname, d.givenName, d.rollClass, d.truancyCount, d.detentionsServed, d.resolved]);
  
        doc.autoTable({
          startY: 25,
          head,
          body,
          styles: { fontSize: 8 },
          headStyles: { fillColor: [41, 128, 185] }
        });
      }
  
      doc.save(`lateness_report_${date} (${optionString}).pdf`);
    } else {
        const workbook = XLSX.utils.book_new();
      
        if (settings.sort === "roll") {
          const rollOrder = ["7", "8", "9", "10", "11", "12", "SUPPORT", "SRC", "Connect Roll"];
          const groups = {};
      
          data.forEach(d => {
            const rc = d.rollClass || "Unknown";
            if (!groups[rc]) groups[rc] = [];
            groups[rc].push(settings.content === "detailed" ? d : {
              surname: d.surname,
              givenName: d.givenName,
              rollClass: d.rollClass,
              truancyCount: d.truancyCount,
              detentionsServed: d.detentionsServed,
              resolved: d.resolved
            });
          });
      
          const sortedRollClasses = Object.keys(groups).sort((a, b) => {
            const ai = rollOrder.findIndex(prefix => a.toUpperCase().startsWith(prefix));
            const bi = rollOrder.findIndex(prefix => b.toUpperCase().startsWith(prefix));
            return (ai !== bi ? ai - bi : a.localeCompare(b));
          });
      
          sortedRollClasses.forEach(rc => {
            const groupData = groups[rc];
            const rows = [
              [{ A: `Generated: ${dateTimeString}` }],  // timestamp row
              ...groupData
            ];
            const ws = XLSX.utils.json_to_sheet([], { skipHeader: true }); // create empty sheet
      
            // Add timestamp manually as a cell
            XLSX.utils.sheet_add_aoa(ws, [[`Generated: ${dateTimeString}`]], { origin: "A1" });
      
            // Add column headers and data
            XLSX.utils.sheet_add_json(ws, groupData, {
              origin: "A3", // leave rows A1 and A2 for spacing
              skipHeader: false
            });
      
            XLSX.utils.book_append_sheet(workbook, ws, rc);
          });
      
        } else {
          const exportData = data.map(d => settings.content === "detailed" ? d : {
            surname: d.surname,
            givenName: d.givenName,
            rollClass: d.rollClass,
            truancyCount: d.truancyCount,
            detentionsServed: d.detentionsServed,
            resolved: d.resolved
          });
      
          const ws = XLSX.utils.json_to_sheet([], { skipHeader: true });
          XLSX.utils.sheet_add_aoa(ws, [[`Generated: ${dateTimeString}`]], { origin: "A1" });
          XLSX.utils.sheet_add_json(ws, exportData, { origin: "A3", skipHeader: false });
      
          XLSX.utils.book_append_sheet(workbook, ws, "Lateness Report");
        }
      
        XLSX.writeFile(workbook, `lateness_report_${date} (${optionString}).xlsx`);
      }
      
  });
  
  