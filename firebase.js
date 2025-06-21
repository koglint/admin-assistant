// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyATW9PpkwE7r7XTrlq1oKWMhHAEe-JNNec",
  authDomain: "admin-assistant-6dd20.firebaseapp.com",
  projectId: "admin-assistant-6dd20",
  storageBucket: "admin-assistant-6dd20.firebasestorage.app",
  messagingSenderId: "1058950484184",
  appId: "1:1058950484184:web:c6f16e085cdb433c2c07ad",
  measurementId: "G-9T8CE5Y6PP"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);