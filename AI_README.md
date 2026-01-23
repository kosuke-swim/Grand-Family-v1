# AI_README.md - Grand-Family セキュリティ実装ドキュメント

このドキュメントは、AIアシスタント（Antigravity）との対話を通じて実装されたセキュリティ対策を記録したものです。

---

## 📋 概要

| 項目 | 内容 |
|------|------|
| 実施日 | 2026-01-23 |
| 対象アプリ | Grand-Family（親族名簿管理システム） |
| 技術スタック | Firebase Hosting + Firestore + Alpine.js + Vite |

---

## 🔐 セキュリティ対策の経緯

### Phase 1: 匿名認証の導入

**問題点（Before）**
```javascript
// firestore.rules - 誰でもアクセス可能だった
allow read: if true;
allow write: if true;
```

**解決策（After）**
1. `src/firebase.js` に匿名認証関数 `initializeFirebaseAuth()` を追加
2. `src/app.js` の `init()` で起動時に自動実行
3. `firestore.rules` を `request.auth != null` に変更

**効果**: REST API直接アクセス、ボットスキャンを遮断

---

### Phase 2: データバリデーション

**問題点**: 空の名前、巨大文字列などの不正データを登録可能

**解決策**: Firestoreルールにバリデーション関数を追加
```javascript
function isValidMember(data) {
  // firstName, lastName: 必須、1〜50文字
  // registry: 'magomago' or 'tengoku' のみ
  // generation: 整数(≥1) or null
  // branchId: 整数 or null
}
```

**効果**: 不正データ挿入、DoS攻撃を防止

---

### Phase 3（保留）: 管理者限定

**検討内容**: 書き込み権限を特定UIDのみに制限

**保留理由**: 家族全員が編集できる利便性を優先

**将来の選択肢**:
- 管理者のみ書き込み許可
- 申請フォーム方式（申請→承認→反映）
- Firebase App Check 導入

---

## 👥 専門家シミュレーション

セキュリティ設計にあたり、5人の仮想専門家によるレビューを実施:

1. **🔒 Mr. Lock（セキュリティ監査人）**: ゼロトラスト視点
2. **🔥 Ms. Fire（Firebase専門）**: 実装の最適解
3. **🎨 Mr. UI（フロントエンド）**: UX視点
4. **🏴‍☠️ BlackHat san（ホワイトハッカー）**: 攻撃者視点
5. **🛡️ Ms. Shield（プライバシー責任者）**: コンプライアンス視点

---

## 🎯 脅威モデル

| 攻撃者 | リスク | 対策状況 |
|--------|--------|---------|
| 自動ボット | 高 | ✅ 匿名認証で遮断 |
| 名簿業者 | 中〜高 | ⚠️ 認証必須だが読み取り可 |
| 内部不正 | 低 | ⚠️ 全員編集可 |

---

## 📁 変更ファイル一覧

| ファイル | 変更内容 |
|----------|---------|
| `src/firebase.js` | 匿名認証関数追加 |
| `src/app.js` | 初期化時に匿名認証実行 |
| `firestore.rules` | 認証必須 + バリデーション |
| `index.html` | 修正ボタンを控えめなデザインに変更、家系図コンテナのインラインスタイル削除 |
| `src/styles.css` | 家系図コンテナに和モダンボーダー + フェード効果追加 |

---

## � データモデル設計（モデリング）

現実の家族関係をFirestore上でどう表現したかの記録です。

### Members コレクション構造

ドキュメントID: 自動生成（ランダムID）

| フィールド | 型 | 説明 | 設計意図（Why） |
|------------|----|------|-----------------|
| `lastName` / `firstName` | string | 姓 / 名 | 表示用。検索やソートに使用。 |
| `birthDate` | string | 生年月日 | `YYYYMMDD`形式。年齢計算や順序並べ替えを容易にするため数値的な文字列を採用。 |
| `registry` | string | 区分 | `'magomago'`(生存) / `'tengoku'`(故人)。状態をフラグ管理し、UIの出し分けに使用。 |
| `parentId` | string | 親ID | **【重要】** 親（父または母）のドキュメントID。子から親を参照する単方向リンクで木構造を表現。 |
| `branchId` | number | 枝番 | 1〜9の整数。始祖（各家系のトップ）を識別するためのグループID。 |
| `spouseId` | string | 配偶者ID | **【重要】** 配偶者のドキュメントID。相互にIDを持ち合う双方向リンクで夫婦関係を表現。 |
| `passedAt` | string | 没年月日 | 天国会員のみ。`YYYYMMDD`形式。 |

### リレーションシップの設計判断

1.  **親子関係（Tree構造）**
    *   **設計**: 子が `parentId` を持つ形式
    *   **理由**: 親が `children: []` 配列を持つ形式だと、子供が増えるたびに親データを更新する必要があり、競合リスクがあるため。

2.  **夫婦関係（横の繋がり）**
    *   **設計**: お互いに `spouseId` を持つ（双方向）
    *   **理由**: 家系図描画時に、本人の隣に配偶者を即座に表示するため。片方向だと検索コストがかかる。

---

## 🔧 Firebaseコンソール設定
| Authentication | 匿名ログイン: **有効** |
| Firestore Rules | `request.auth != null` 必須 |

---

## 📝 今後の検討事項

1. **管理者限定モード**: 必要時に書き込み権限を制限
2. **申請フォーム**: 家族からの更新リクエストを管理者が承認
3. **App Check**: reCAPTCHA Enterprise によるボット完全排除
4. **監査ログ**: アクセス履歴の記録

---

## 🏷️ メタ情報

- 作成: AIアシスタント (Antigravity)
- 会話ID: d0d02cfb-c3ff-42c6-ba8f-6dd72e239f7c
