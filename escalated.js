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
    updateDoc,
    doc
  } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
  
  
  // UI elements
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const userInfo = document.getElementById('user-info');
  
  let allStudents = [];
  
  // Auth setup
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
      document.body.style.display = "block";
      await refreshPage();
    } else {
      userInfo.textContent = "";
      loginBtn.style.display = "inline-block";
      logoutBtn.style.display = "none";
      document.body.style.display = "none";
    }
  });
  
  // Load all students
  async function loadAllStudents() {
    const snapshot = await getDocs(collection(db, 'students'));
    allStudents = [];
    snapshot.forEach(docSnap => {
      const student = docSnap.data();
      allStudents.push({
        id: docSnap.id,
        name: `${student.givenName} ${student.surname}`,
        rollClass: student.rollClass || '',
        truancies: student.truancies || [],
        escalated: !!student.escalated
      });
    });
  }
  
  // Render currently escalated students
  function renderEscalatedList() {
    const tbody = document.getElementById('escalated-body');
    tbody.innerHTML = '';
    allStudents
      .filter(s => s.escalated)
      .forEach(student => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${student.name}</td>
          <td>${student.rollClass}</td>
          <td>${student.truancies.length}</td>
          <td><button data-id="${student.id}" class="remove-escalated">Remove</button></td>
        `;
        tbody.appendChild(row);
      });
  }
  
  // Render search results to escalate
  function renderSearchResults(query) {
    const results = document.getElementById('search-results');
    results.innerHTML = '';
  
    const lower = query.toLowerCase();
    const matches = allStudents
      .filter(s =>
        !s.escalated &&
        (s.name.toLowerCase().includes(lower) || s.rollClass.toLowerCase().includes(lower))
      );
  
    matches.forEach(student => {
      const li = document.createElement('li');
      li.innerHTML = `
        ${student.name} (${student.rollClass})
        <button data-id="${student.id}" class="add-escalated">Escalate</button>
      `;
      results.appendChild(li);
    });
  }
  
  document.getElementById('search-input').addEventListener('input', (e) => {
    renderSearchResults(e.target.value);
  });
  
  document.addEventListener('click', async (e) => {
    if (e.target.classList.contains('add-escalated')) {
      const id = e.target.dataset.id;
      await updateDoc(doc(db, 'students', id), { escalated: true });
      await refreshPage();
    }
  
    if (e.target.classList.contains('remove-escalated')) {
      const id = e.target.dataset.id;
      await updateDoc(doc(db, 'students', id), { escalated: false });
      await refreshPage();
    }
  });
  
  async function refreshPage() {
    await loadAllStudents();
    renderEscalatedList();
    renderSearchResults(document.getElementById('search-input').value);
  }
  