// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyATW9PpkwE7r7XTrlq1oKWMhHAEe-JNNec",
  authDomain: "admin-assistant-6dd20.firebaseapp.com",
  projectId: "admin-assistant-6dd20",
  storageBucket: "admin-assistant-6dd20.appspot.com",
  messagingSenderId: "1058950484184",
  appId: "1:1058950484184:web:c6f16e085cdb433c2c07ad",
  measurementId: "G-9T8CE5Y6PP"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export {
  auth,
  db,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
};
