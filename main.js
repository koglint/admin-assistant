// main.js
import { auth, db, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from './firebase.js';

const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const content = document.getElementById('content');

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

onAuthStateChanged(auth, (user) => {
  if (user) {
    userInfo.textContent = `Signed in as: ${user.displayName} (${user.email})`;
    loginBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";
    content.style.display = "block";
    loadTruancies(); // 👈 show data right after login

  } else {
    userInfo.textContent = "";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    content.style.display = "none";
  }
});

function loadTruancies() {
  const tableBody = document.getElementById("truancy-body");
  tableBody.innerHTML = ""; // Clear existing rows

  db.collection("students").get().then(snapshot => {
    snapshot.forEach(doc => {
      const student = doc.data();
      const studentId = doc.id;

      if (!student.truancies) return;

      student.truancies.forEach((t, index) => {
        const tr = document.createElement("tr");

        tr.innerHTML = `
          <td>${student.fullName}</td>
          <td>${t.date}</td>
          <td>${t.arrivalTime || '-'}</td>
          <td>${t.minutesLate ?? '-'}</td>
          <td>${t.detentionIssued ? "✅" : "❌"}</td>
          <td>${t.resolved ? "✅" : "❌"}</td>
          <td>${t.justified ? "✅" : "❌"}</td>
          <td>
            <button data-stu="${studentId}" data-idx="${index}" class="mark-issued">Issue</button>
            <button data-stu="${studentId}" data-idx="${index}" class="mark-served">Serve</button>
            <button data-stu="${studentId}" data-idx="${index}" class="mark-justified">Justify</button>
          </td>
        `;

        tableBody.appendChild(tr);
      });
    });
  });
}


document.addEventListener("click", async (e) => {
  if (e.target.matches("button.mark-issued") ||
      e.target.matches("button.mark-served") ||
      e.target.matches("button.mark-justified")) {

    const studentId = e.target.dataset.stu;
    const index = parseInt(e.target.dataset.idx);

    const docRef = db.collection("students").doc(studentId);
    const doc = await docRef.get();
    const data = doc.data();

    const updated = [...data.truancies];
    if (!updated[index]) return;

    if (e.target.classList.contains("mark-issued")) {
      updated[index].detentionIssued = true;
    } else if (e.target.classList.contains("mark-served")) {
      updated[index].resolved = true;
    } else if (e.target.classList.contains("mark-justified")) {
      updated[index].justified = true;
    }

    await docRef.update({ truancies: updated });
    loadTruancies();
  }
});



const form = document.getElementById('upload-form');
const fileInput = document.getElementById('xls-file');
const statusDiv = document.getElementById('upload-status');

// Replace this with your actual Render backend URL
const BACKEND_URL = "https://admin-assistant-backend.onrender.com/upload";

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  statusDiv.textContent = "Uploading...";

  try {
    const response = await fetch(BACKEND_URL, {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    if (data.status === "success") {
      statusDiv.textContent = `Uploaded! ${data.added} truants recorded.`;
      loadTruancies(); // 👈 Refresh the table after upload

    } else {
      statusDiv.textContent = "Upload failed. Check file format.";
    }
  } catch (err) {
    console.error(err);
    statusDiv.textContent = "Error uploading file.";
  }
});

