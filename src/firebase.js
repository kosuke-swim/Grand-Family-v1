// Firebase設定
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

const firebaseConfig = {
    apiKey: "AIzaSyC1qH5x2i9rpe0Tex5NlkX5AB-VjezDEIg",
    authDomain: "magomago-meibo.firebaseapp.com",
    projectId: "grand-family-v1",
    storageBucket: "grand-family-v1.firebasestorage.app",
    messagingSenderId: "655538664149",
    appId: "1:655538664149:web:ab11336439c4db0a5fa85c"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

/**
 * Firebase匿名認証を初期化
 * アプリ起動時に自動でサインインし、Firestoreルールでrequest.authを使用可能にする
 * @returns {Promise<void>}
 */
export async function initializeFirebaseAuth() {
    return new Promise((resolve, reject) => {
        // 認証状態の変化を監視
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            unsubscribe(); // 初回のみ実行

            if (user) {
                // 既にサインイン済み
                console.log('Firebase Auth: 既存セッション復元 (UID:', user.uid, ')');
                resolve();
            } else {
                // 未サインインなら匿名認証を実行
                try {
                    const userCredential = await signInAnonymously(auth);
                    console.log('Firebase Auth: 匿名認証成功 (UID:', userCredential.user.uid, ')');
                    resolve();
                } catch (error) {
                    console.error('Firebase Auth: 匿名認証エラー:', error);
                    reject(error);
                }
            }
        });
    });
}
