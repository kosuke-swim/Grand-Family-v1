// Firebase設定
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
    apiKey: "AIzaSyC1qH5x2i9rpe0Tex5NlkX5AB-VjezDEIg",
    authDomain: "grand-family-v1.firebaseapp.com",
    projectId: "grand-family-v1",
    storageBucket: "grand-family-v1.firebasestorage.app",
    messagingSenderId: "655538664149",
    appId: "1:655538664149:web:ab11336439c4db0a5fa85c"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
