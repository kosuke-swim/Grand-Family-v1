// scripts/seed.js - 始祖データをFirestoreに投入するスクリプト
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyC1qH5x2i9rpe0Tex5NlkX5AB-VjezDEIg",
    authDomain: "grand-family-v1.firebaseapp.com",
    projectId: "grand-family-v1",
    storageBucket: "grand-family-v1.firebasestorage.app",
    messagingSenderId: "655538664149",
    appId: "1:655538664149:web:ab11336439c4db0a5fa85c"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 始祖データ
const founderData = {
    firstName: '太郎',
    lastName: '山田',
    registry: 'tengoku', // 故人
    branchId: null,      // 始祖には枝番なし
    generation: 1,       // 第1世代 = 始祖
    parentId: null,      // 始祖には親なし
    birthDate: '1920-01-01',
    passedAt: '2000-12-31',
    address: '東京都',
    phone: null,
    createdAt: new Date()
};

async function seed() {
    try {
        // 固定のドキュメントIDで作成（重複防止）
        const docRef = doc(db, 'members', 'founder-yamada-taro');
        await setDoc(docRef, founderData);
        console.log('✅ 始祖データを登録しました:', docRef.id);
        console.log(founderData);
    } catch (error) {
        console.error('❌ エラー:', error);
    }
}

seed();
