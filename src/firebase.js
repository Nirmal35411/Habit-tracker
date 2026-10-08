import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
} from "firebase/auth";

import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

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

/*
 * =========================================================
 * FIREBASE AUTH
 * =========================================================
 */

export const auth = getAuth(app);

export const googleProvider =
  new GoogleAuthProvider();

/*
 * =========================================================
 * FIRESTORE OFFLINE-FIRST CONFIGURATION
 * =========================================================
 *
 * Firestore keeps a persistent local cache in IndexedDB.
 *
 * This means:
 *
 * ONLINE
 *   Local write → Firestore
 *
 * OFFLINE
 *   Local write → IndexedDB
 *
 * WHEN CONNECTION RETURNS
 *   IndexedDB → Firestore automatically
 *
 * Multiple browser tabs can safely share
 * the same Firestore cache.
 */

export const db =
  initializeFirestore(app, {
    localCache:
      persistentLocalCache({
        tabManager:
          persistentMultipleTabManager(),
      }),
  });
