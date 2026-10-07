// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAIA7lZrwCWdy6DRZBmny2kFGfGT2DD07U",
  authDomain: "habit-tracker-64e92.firebaseapp.com",
  projectId: "habit-tracker-64e92",
  storageBucket: "habit-tracker-64e92.firebasestorage.app",
  messagingSenderId: "173325389332",
  appId: "1:173325389332:web:1672bbea506b01fbf66101",
  measurementId: "G-W62LKHSREJ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

export const googleProvider =
  new GoogleAuthProvider();

export const db = getFirestore(app);
