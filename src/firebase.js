import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
 apiKey: "AIzaSyAIA7lZrwCWdy6DRZBmny2kFGfGT2DD07U",
  authDomain: "habit-tracker-64e92.firebaseapp.com",
  projectId: "habit-tracker-64e92",
  storageBucket: "habit-tracker-64e92.firebasestorage.app",
  messagingSenderId: "173325389332",
  appId: "1:173325389332:web:1672bbea506b01fbf66101",
  measurementId: "G-W62LKHSREJ"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
