// auth.js - 認証モジュール
// yamada1892 + 生年月日8桁による簡易認証

import { db } from '../firebase.js';
import { collection, query, where, getDocs } from 'firebase/firestore';

const SESSION_KEY = 'grand-family-session';
const VALID_ID = 'yamada1892';

export default function authModule() {
    return {
        // 認証状態
        isAuthenticated: false,

        // ログインフォーム
        loginId: '',
        loginPassword: '',
        showPassword: false,
        loginError: '',
        isLoggingIn: false,

        /**
         * セッション確認（初期化時に呼び出し）
         */
        checkSession() {
            const session = localStorage.getItem(SESSION_KEY);
            if (session) {
                try {
                    const data = JSON.parse(session);
                    // セッションが有効か確認（24時間以内）
                    const now = Date.now();
                    const sessionAge = now - (data.timestamp || 0);
                    const maxAge = 24 * 60 * 60 * 1000; // 24時間

                    if (sessionAge < maxAge && data.authenticated) {
                        this.isAuthenticated = true;
                        console.log('セッション復元成功');
                        return true;
                    }
                } catch (e) {
                    console.error('セッション解析エラー:', e);
                }
            }
            this.isAuthenticated = false;
            return false;
        },

        /**
         * ログイン処理
         */
        async login() {
            this.loginError = '';
            this.isLoggingIn = true;

            try {
                // ID確認
                if (this.loginId !== VALID_ID) {
                    this.loginError = 'IDが正しくありません';
                    return false;
                }

                // パスワード形式確認（8桁の数字）
                const password = this.loginPassword.trim();
                if (!/^\d{8}$/.test(password)) {
                    this.loginError = '生年月日は8桁の数字で入力してください（例: 19560423）';
                    return false;
                }

                // YYYYMMDD → YYYY-MM-DD 形式に変換
                const birthDate = `${password.slice(0, 4)}-${password.slice(4, 6)}-${password.slice(6, 8)}`;

                // Firestoreで該当するメンバーを検索
                const membersRef = collection(db, 'members');
                const q = query(membersRef, where('birthDate', '==', birthDate));
                const snapshot = await getDocs(q);

                if (snapshot.empty) {
                    this.loginError = '登録されていない生年月日です';
                    return false;
                }

                // 認証成功
                this.isAuthenticated = true;
                this.loginId = '';
                this.loginPassword = '';

                // セッション保存
                localStorage.setItem(SESSION_KEY, JSON.stringify({
                    authenticated: true,
                    timestamp: Date.now()
                }));

                console.log('ログイン成功');
                return true;

            } catch (error) {
                console.error('ログインエラー:', error);
                this.loginError = 'ログイン処理中にエラーが発生しました';
                return false;
            } finally {
                this.isLoggingIn = false;
            }
        },

        /**
         * ログアウト処理
         */
        logout() {
            this.isAuthenticated = false;
            localStorage.removeItem(SESSION_KEY);
            console.log('ログアウト完了');
        }
    };
}
