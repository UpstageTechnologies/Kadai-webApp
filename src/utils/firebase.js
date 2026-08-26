import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// ✅ Puthusa create panna 'Kadai-web' App-oda Configuration
const firebaseConfig = {
  apiKey: "AIzaSyCWpL_KZPGeYUZ5pLiDzx-X6Vi0Q5J8xRI",
  authDomain: "scaner-billing.firebaseapp.com",
  projectId: "scaner-billing",
  storageBucket: "scaner-billing.firebasestorage.app",
  messagingSenderId: "207862672282",
  appId: "1:207862672282:web:1d5d5529b31148ac1ae823"
};

// ✅ Initialize Firebase App
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// ✅ Export services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;