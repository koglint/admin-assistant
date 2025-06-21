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
  } else {
    userInfo.textContent = "";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    content.style.display = "none";
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
      statusDiv.textContent = `Uploaded! ${data.updated} truants recorded.`;
    } else {
      statusDiv.textContent = "Upload failed. Check file format.";
    }
  } catch (err) {
    console.error(err);
    statusDiv.textContent = "Error uploading file.";
  }
});

