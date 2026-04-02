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

const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const searchInput = document.getElementById('search-input');

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
    document.body.style.display = "block";
    await refreshPage();
  } else {
    currentUserDescriptor = "unknown_user";
    userInfo.textContent = "";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    document.body.style.display = "none";
  }
});

searchInput.addEventListener('input', (e) => {
  renderSearchResults(e.target.value);
});

document.addEventListener('click', async (e) => {
  if (e.target.classList.contains('add-escalated')) {
    const student = allStudents.find(item => item.id === e.target.dataset.id);
    if (!student) return;

    await runTransaction(db, async (transaction) => {
      const ref = doc(db, 'students', student.id);
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
    const student = allStudents.find(item => item.id === e.target.dataset.id);
    if (!student) return;

    await runTransaction(db, async (transaction) => {
      const ref = doc(db, 'students', student.id);
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
    const student = allStudents.find(item => item.id === e.target.dataset.id);
    if (!student) return;

    await runTransaction(db, async (transaction) => {
      const ref = doc(db, 'students', student.id);
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
}

async function loadAllStudents() {
  const snapshot = await getDocs(collection(db, 'students'));
  allStudents = snapshot.docs.map(docSnap => {
    const student = docSnap.data();
    return {
      id: docSnap.id,
      name: `${student.givenName || ''} ${student.surname || ''}`.trim(),
      rollClass: student.rollClass || '',
      lateCount: student.lateCount || student.truancyCount || 0,
      escalated: !!student.escalated,
      escalationReasons: student.escalationReasons || [],
      activeDetention: student.activeDetention || null,
      detentionHistory: student.detentionHistory || []
    };
  });
}

function renderEscalatedList() {
  const tbody = document.getElementById('escalated-body');
  tbody.innerHTML = '';

  allStudents
    .filter(student => student.escalated)
    .sort((a, b) => a.rollClass.localeCompare(b.rollClass) || a.name.localeCompare(b.name))
    .forEach(student => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${student.name}</td>
        <td>${student.rollClass}</td>
        <td>${student.lateCount}</td>
        <td>${formatReasons(student.escalationReasons)}</td>
        <td>${formatDetentionStatus(student.activeDetention)}</td>
        <td>
          <button class="return-to-roll" data-id="${student.id}">Return to Detention Roll</button>
          <button class="clear-escalation secondary-btn" data-id="${student.id}">Clear</button>
        </td>
      `;
      tbody.appendChild(row);
    });
}

function renderSearchResults(query) {
  const results = document.getElementById('search-results');
  results.innerHTML = '';

  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return;

  allStudents
    .filter(student => !student.escalated)
    .filter(student =>
      student.name.toLowerCase().includes(trimmed) ||
      student.rollClass.toLowerCase().includes(trimmed)
    )
    .forEach(student => {
      const li = document.createElement('li');
      li.innerHTML = `${student.name} (${student.rollClass}) <button data-id="${student.id}" class="add-escalated">Escalate</button>`;
      results.appendChild(li);
    });
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
