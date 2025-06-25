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
    const snapshot = await getDocs(collection(db, "students"));
  
    snapshot.forEach(docSnap => {
      const student = docSnap.data();
  
      if (!student.truancies || student.truancies.length === 0) return;
  
      const latest = [...student.truancies].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${student.fullName}</td>
        <td>${student.rollClass}</td>
        <td>${student.truancyCount || 0}</td>
        <td>${student.detentionsServed || 0}</td>
        <td>${latest?.date ?? '-'}</td>
      `;
      tableBody.appendChild(tr);
    });
  }
  