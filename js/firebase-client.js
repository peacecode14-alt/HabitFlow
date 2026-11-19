// HabitFlow Firebase web configuration.
// Firebase web config is public by design; protect data with Authentication and Firestore Rules.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAs6iYOHedal4YRBypuosZPWjLCzkScz1w",
  authDomain: "habitflow-aed6b.firebaseapp.com",
  projectId: "habitflow-aed6b",
  storageBucket: "habitflow-aed6b.firebasestorage.app",
  messagingSenderId: "884332517564",
  appId: "1:884332517564:web:5047b72b81748578e058b9",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
