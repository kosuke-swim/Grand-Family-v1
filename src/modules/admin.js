// admin.js - 管理者機能モジュール
// 新規メンバー登録、親選択時の自動計算ロジックを担当

import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase.js';

export default function adminModule() {
    return {
        // --- State ---
        allMembers: [],
        newMember: {
            firstName: '',
            lastName: '',
            registry: 'magomago',
            branchId: null,
            generation: null,
            parentId: '',
            spouseId: '',  // 配偶者ID
            birthDate: '',
            passedAt: null,
            address: '',
            phone: ''
        },

        // 9人兄弟の枝番ラベル
        branchLabels: {
            1: '神田家',
            2: '永田家',
            3: '片山家',
            4: '山田裕子',
            5: '山田家（竹原）',
            6: '田中家',
            7: '山田家（福山）',
            8: '三好家',
            9: '大本家'
        },

        // 選択された親の世代（始祖判定用）
        selectedParentGeneration: null,

        // 配偶者同時登録用
        addSpouseTogether: false,
        newSpouse: {
            firstName: '',
            lastName: '',
            birthDate: '',
            registry: 'tengoku',
            passedAt: null
        },

        // 編集モード用
        isEditing: false,
        editMember: {
            firstName: '',
            lastName: '',
            registry: 'magomago',
            birthDate: '',
            passedAt: '',
            spouseId: '',
            phone: '',
            address: ''
        },

        // 配偶者検索用（編集モーダル）
        spouseSearchQuery: '',
        showSpouseDropdown: false,

        // 削除確認モーダル用
        deleteConfirmMessage: '',
        deleteSpouseOption: false,
        deleteSpouseTogether: false,
        deleteSpouseName: '',
        pendingDeleteMemberId: null,
        pendingDeleteSpouseId: null,

        // --- Computed ---
        get isFormValid() {
            const m = this.newMember;
            // 必須: 姓、名、親、世代、枝番
            return (
                m.firstName &&
                m.lastName &&
                m.parentId &&
                m.generation &&
                m.branchId
            );
        },

        /**
         * 配偶者候補のフィルタ済みリスト（編集モーダル用インクリメンタル検索）
         */
        get filteredSpouseCandidates() {
            if (!this.spouseSearchQuery) return [];
            const query = this.spouseSearchQuery.toLowerCase();
            return this.allMembers.filter((m) => {
                // 自分自身は除外
                if (this.editMember && m.id === this.editMember.id) return false;
                const fullName = `${m.lastName}${m.firstName}`.toLowerCase();
                return fullName.includes(query);
            });
        },

        // --- Methods ---

        /**
         * 親選択時のイベントハンドラ
         * generation, branchId を自動計算
         */
        onParentSelect() {
            const parentId = this.newMember.parentId;

            if (!parentId) {
                // 親未選択時はリセット
                this.newMember.generation = null;
                this.newMember.branchId = null;
                this.selectedParentGeneration = null;
                return;
            }

            // 親データを取得
            const parent = this.allMembers.find((m) => m.id === parentId);
            if (!parent) {
                console.warn('Parent not found:', parentId);
                return;
            }

            this.selectedParentGeneration = parent.generation;

            // generation: 親の世代 + 1
            this.newMember.generation = parent.generation + 1;

            // branchId: 親が始祖(Gen 1)の場合は手動選択
            // それ以外は親の枝番を継承
            if (parent.generation === 1) {
                // 始祖が親 → branchIdはユーザーが手動選択
                this.newMember.branchId = null;
            } else {
                // 親の枝番を継承
                this.newMember.branchId = parent.branchId;
            }
        },

        /**
         * 新規メンバーを保存
         */
        async saveMember() {
            if (!this.isFormValid) {
                alert('必須項目を入力してください');
                return;
            }

            // 配偶者同時登録の場合は別メソッドへ
            if (this.addSpouseTogether && this.newSpouse.firstName) {
                return this.saveMemberWithSpouse();
            }

            try {
                const memberData = {
                    firstName: this.newMember.firstName,
                    lastName: this.newMember.lastName,
                    registry: this.newMember.registry,
                    branchId: this.newMember.branchId,
                    generation: this.newMember.generation,
                    parentId: this.newMember.parentId,
                    spouseId: this.newMember.spouseId || null,
                    birthDate: this.newMember.birthDate || null,
                    passedAt:
                        this.newMember.registry === 'tengoku'
                            ? this.newMember.passedAt
                            : null,
                    address: this.newMember.address || null,
                    phone: this.newMember.phone || null,
                    createdAt: new Date()
                };

                // Firestore に保存（モジュール内で直接dbを参照）
                const docRef = await addDoc(
                    collection(db, 'members'),
                    memberData
                );
                console.log('Member saved:', docRef.id);

                // ローカルStateに追加
                this.allMembers.push({ ...memberData, id: docRef.id });

                // フォームリセット
                this.resetNewMemberForm();

                // モーダルを閉じる
                const modal = bootstrap.Modal.getInstance(
                    document.getElementById('addMemberModal')
                );
                if (modal) modal.hide();

                this.showSuccessModal('登録が完了しました！');
            } catch (error) {
                console.error('Save failed:', error);
                alert('保存に失敗しました: ' + error.message);
            }
        },

        /**
         * 配偶者と同時に新規メンバーを保存（Batch書き込み）
         */
        async saveMemberWithSpouse() {
            try {
                // 事前にIDを生成
                const memberRef = doc(collection(db, 'members'));
                const spouseRef = doc(collection(db, 'members'));

                const memberData = {
                    firstName: this.newMember.firstName,
                    lastName: this.newMember.lastName,
                    registry: this.newMember.registry,
                    branchId: this.newMember.branchId,
                    generation: this.newMember.generation,
                    parentId: this.newMember.parentId,
                    spouseId: spouseRef.id,  // 配偶者のIDを設定
                    birthDate: this.newMember.birthDate || null,
                    passedAt:
                        this.newMember.registry === 'tengoku'
                            ? this.newMember.passedAt
                            : null,
                    address: this.newMember.address || null,
                    phone: this.newMember.phone || null,
                    createdAt: new Date()
                };

                const spouseData = {
                    firstName: this.newSpouse.firstName,
                    lastName: this.newSpouse.lastName,
                    registry: this.newSpouse.registry,
                    branchId: this.newMember.branchId,  // 同じ枝番
                    generation: this.newMember.generation,  // 同じ世代
                    parentId: null,  // 配偶者は親を持たない（嫁入り/婿入り）
                    spouseId: memberRef.id,  // 本人のIDを設定（相互リンク）
                    birthDate: this.newSpouse.birthDate || null,
                    passedAt:
                        this.newSpouse.registry === 'tengoku'
                            ? this.newSpouse.passedAt
                            : null,
                    address: null,
                    phone: null,
                    createdAt: new Date()
                };

                // Batch書き込みでアトミックに保存
                const batch = writeBatch(db);
                batch.set(memberRef, memberData);
                batch.set(spouseRef, spouseData);
                await batch.commit();

                console.log('Member and spouse saved:', memberRef.id, spouseRef.id);

                // ローカルStateに追加
                this.allMembers.push({ ...memberData, id: memberRef.id });
                this.allMembers.push({ ...spouseData, id: spouseRef.id });

                // フォームリセット
                this.resetNewMemberForm();

                // モーダルを閉じる
                const modal = bootstrap.Modal.getInstance(
                    document.getElementById('addMemberModal')
                );
                if (modal) modal.hide();

                this.showSuccessModal('夫婦を同時登録しました！');
            } catch (error) {
                console.error('Save failed:', error);
                alert('保存に失敗しました: ' + error.message);
            }
        },

        /**
         * フォームをリセット
         */
        resetNewMemberForm() {
            this.newMember = {
                firstName: '',
                lastName: '',
                registry: 'magomago',
                branchId: null,
                generation: null,
                parentId: '',
                spouseId: '',
                birthDate: '',
                passedAt: null,
                address: '',
                phone: ''
            };
            this.selectedParentGeneration = null;
            // 配偶者同時登録もリセット
            this.addSpouseTogether = false;
            this.newSpouse = {
                firstName: '',
                lastName: '',
                birthDate: '',
                registry: 'tengoku',
                passedAt: null
            };
        },

        /**
         * 全メンバーをFirestoreから取得
         */
        async fetchAllMembers() {
            console.log('fetchAllMembers called');
            try {
                // モジュール内で直接dbを参照
                const querySnapshot = await getDocs(collection(db, 'members'));
                this.allMembers = querySnapshot.docs.map((doc) => ({
                    id: doc.id,
                    ...doc.data()
                }));
                // クライアント側でソート
                this.allMembers.sort((a, b) => {
                    if (a.generation !== b.generation) return a.generation - b.generation;
                    return (a.lastName || '').localeCompare(b.lastName || '');
                });
                console.log('Fetched members:', this.allMembers.length, this.allMembers);
            } catch (error) {
                console.error('Fetch failed:', error);
                // エラー時はダミーデータを使用（開発用）
                console.log('Using dummy data due to error');
                this.allMembers = this.getDummyMembers();
            }
        },

        /**
         * 開発用ダミーデータ
         */
        getDummyMembers() {
            return [
                {
                    id: 'founder-1',
                    firstName: '太郎',
                    lastName: '山田',
                    registry: 'tengoku',
                    branchId: null,
                    generation: 1,
                    parentId: null,
                    birthDate: '1920-01-01',
                    passedAt: '2000-12-31',
                    address: '東京都',
                    phone: null
                }
            ];
        },

        /**
         * 編集モードを開始
         */
        openEditMember(member) {
            this.isEditing = true;
            // ディープコピーして編集用オブジェクトを作成
            this.editMember = { ...member };
            // モーダルを開く
            const modal = new bootstrap.Modal(document.getElementById('editMemberModal'));
            modal.show();
        },

        /**
         * 編集をキャンセル
         */
        cancelEdit() {
            this.isEditing = false;
            this.editMember = {
                firstName: '',
                lastName: '',
                registry: 'magomago',
                birthDate: '',
                passedAt: '',
                spouseId: '',
                phone: '',
                address: ''
            };
            // 配偶者検索もリセット
            this.spouseSearchQuery = '';
            this.showSpouseDropdown = false;
            const modal = bootstrap.Modal.getInstance(document.getElementById('editMemberModal'));
            if (modal) modal.hide();
        },

        /**
         * 配偶者を選択（編集モーダル用）
         */
        selectSpouse(member) {
            this.editMember.spouseId = member.id;
            this.spouseSearchQuery = '';
            this.showSpouseDropdown = false;
        },

        /**
         * 配偶者選択を解除（編集モーダル用）
         */
        clearSpouseSelection() {
            this.editMember.spouseId = '';
            this.spouseSearchQuery = '';
        },

        /**
         * 編集を保存
         */
        async saveEdit() {
            if (!this.editMember) return;

            try {
                // 編集前の元データを取得
                const originalMember = this.allMembers.find(m => m.id === this.editMember.id);
                const oldSpouseId = originalMember?.spouseId || null;
                const newSpouseId = this.editMember.spouseId || null;

                const updateData = {
                    firstName: this.editMember.firstName,
                    lastName: this.editMember.lastName,
                    registry: this.editMember.registry,
                    spouseId: newSpouseId,
                    birthDate: this.editMember.birthDate || null,
                    passedAt: this.editMember.registry === 'tengoku'
                        ? this.editMember.passedAt
                        : null,
                    address: this.editMember.address || null,
                    phone: this.editMember.phone || null,
                    updatedAt: new Date()
                };

                // Batch書き込みで配偶者リンクを双方向更新
                const batch = writeBatch(db);
                const memberRef = doc(db, 'members', this.editMember.id);
                batch.update(memberRef, updateData);

                // 配偶者が変更された場合
                if (oldSpouseId !== newSpouseId) {
                    // 旧配偶者のリンクを解除
                    if (oldSpouseId) {
                        const oldSpouseRef = doc(db, 'members', oldSpouseId);
                        batch.update(oldSpouseRef, { spouseId: null, updatedAt: new Date() });
                    }
                    // 新配偶者にリンクを設定
                    if (newSpouseId) {
                        const newSpouseRef = doc(db, 'members', newSpouseId);
                        batch.update(newSpouseRef, { spouseId: this.editMember.id, updatedAt: new Date() });
                    }
                }

                await batch.commit();
                console.log('Member updated:', this.editMember.id);

                // ローカルStateを更新
                const index = this.allMembers.findIndex(m => m.id === this.editMember.id);
                if (index !== -1) {
                    this.allMembers[index] = { ...this.allMembers[index], ...updateData };
                }

                // 配偶者の変更をローカルStateに反映
                if (oldSpouseId !== newSpouseId) {
                    if (oldSpouseId) {
                        const oldSpouseIndex = this.allMembers.findIndex(m => m.id === oldSpouseId);
                        if (oldSpouseIndex !== -1) {
                            this.allMembers[oldSpouseIndex].spouseId = null;
                        }
                    }
                    if (newSpouseId) {
                        const newSpouseIndex = this.allMembers.findIndex(m => m.id === newSpouseId);
                        if (newSpouseIndex !== -1) {
                            this.allMembers[newSpouseIndex].spouseId = this.editMember.id;
                        }
                    }
                }

                this.cancelEdit();
                this.showSuccessModal('更新が完了しました！');
            } catch (error) {
                console.error('Update failed:', error);
                alert('更新に失敗しました: ' + error.message);
            }
        },

        /**
         * 子供がいるかチェック
         */
        hasChildren(memberId) {
            return this.allMembers.some(m => m.parentId === memberId);
        },

        /**
         * 配偶者との相互リンクを取得
         */
        getSpouseDisplayName(spouseId) {
            if (!spouseId) return null;
            const spouse = this.allMembers.find(m => m.id === spouseId);
            if (!spouse) return null;
            return `${spouse.lastName} ${spouse.firstName}`;
        },

        /**
         * 配偶者リンクを解除
         */
        async unlinkSpouse() {
            if (!this.editMember || !this.editMember.spouseId) return;

            const spouse = this.allMembers.find(m => m.id === this.editMember.spouseId);
            const spouseName = spouse ? `${spouse.lastName} ${spouse.firstName}` : '配偶者';

            const confirmMsg = `「${spouseName}」との配偶者リンクを解除しますか？\n\n※ 解除しても、子供は現在の親の下に残ります。\n※ 両者のデータは削除されません。`;
            if (!confirm(confirmMsg)) {
                return;
            }

            try {
                // 双方のspouseIdをnullに更新
                const batch = writeBatch(db);
                const memberRef = doc(db, 'members', this.editMember.id);
                const spouseRef = doc(db, 'members', this.editMember.spouseId);

                batch.update(memberRef, { spouseId: null, updatedAt: new Date() });
                batch.update(spouseRef, { spouseId: null, updatedAt: new Date() });
                await batch.commit();

                // ローカルStateを更新
                const memberIndex = this.allMembers.findIndex(m => m.id === this.editMember.id);
                const spouseIndex = this.allMembers.findIndex(m => m.id === this.editMember.spouseId);
                if (memberIndex !== -1) this.allMembers[memberIndex].spouseId = null;
                if (spouseIndex !== -1) this.allMembers[spouseIndex].spouseId = null;
                this.editMember.spouseId = null;

                alert('配偶者リンクを解除しました。');
            } catch (error) {
                console.error('Unlink failed:', error);
                alert('リンク解除に失敗しました: ' + error.message);
            }
        },

        /**
         * メンバーを削除（安全装置付き）- モーダル表示
         */
        deleteMember() {
            if (!this.editMember) return;

            const memberName = `${this.editMember.lastName} ${this.editMember.firstName}`;

            // 安全装置: 子供がいる場合は削除禁止
            if (this.hasChildren(this.editMember.id)) {
                alert(`「${memberName}」には子供がいるため削除できません。\n先に子供を削除するか、親を変更してください。`);
                return;
            }

            // 配偶者がいる場合
            const spouseId = this.editMember.spouseId;
            const spouse = spouseId ? this.allMembers.find(m => m.id === spouseId) : null;

            if (spouse) {
                // 配偶者にも子供がいないかチェック
                if (this.hasChildren(spouseId)) {
                    alert(`配偶者「${spouse.lastName} ${spouse.firstName}」には子供がいるため削除できません。\n先に配偶者リンクを解除してください。`);
                    return;
                }
                // 配偶者オプションを表示
                this.deleteSpouseOption = true;
                this.deleteSpouseName = `${spouse.lastName} ${spouse.firstName}`;
                this.pendingDeleteSpouseId = spouseId;
            } else {
                this.deleteSpouseOption = false;
                this.deleteSpouseName = '';
                this.pendingDeleteSpouseId = null;
            }

            // 確認モーダル用の状態を設定
            this.deleteConfirmMessage = `「${memberName}」を削除しますか？`;
            this.deleteSpouseTogether = false;
            this.pendingDeleteMemberId = this.editMember.id;

            // 削除確認モーダルを表示
            const modal = new bootstrap.Modal(document.getElementById('deleteConfirmModal'));
            modal.show();
        },

        /**
         * 削除を実行
         */
        async executeDelete() {
            if (!this.pendingDeleteMemberId) return;

            try {
                const batch = writeBatch(db);
                const memberRef = doc(db, 'members', this.pendingDeleteMemberId);
                batch.delete(memberRef);

                const deleteSpouseToo = this.deleteSpouseTogether && this.pendingDeleteSpouseId;
                if (deleteSpouseToo) {
                    const spouseRef = doc(db, 'members', this.pendingDeleteSpouseId);
                    batch.delete(spouseRef);
                }

                await batch.commit();
                console.log('Member deleted:', this.pendingDeleteMemberId, deleteSpouseToo ? `and spouse: ${this.pendingDeleteSpouseId}` : '');

                // ローカルStateから削除
                const index = this.allMembers.findIndex(m => m.id === this.pendingDeleteMemberId);
                if (index !== -1) {
                    this.allMembers.splice(index, 1);
                }
                if (deleteSpouseToo) {
                    const spouseIndex = this.allMembers.findIndex(m => m.id === this.pendingDeleteSpouseId);
                    if (spouseIndex !== -1) {
                        this.allMembers.splice(spouseIndex, 1);
                    }
                }

                // モーダルを閉じる
                const deleteModal = bootstrap.Modal.getInstance(document.getElementById('deleteConfirmModal'));
                if (deleteModal) deleteModal.hide();

                // 編集モーダルも閉じる
                this.cancelEdit();

                // 状態をリセット
                this.pendingDeleteMemberId = null;
                this.pendingDeleteSpouseId = null;
                this.deleteSpouseOption = false;
                this.deleteSpouseTogether = false;

                // 成功通知
                this.showSuccessModal(deleteSpouseToo ? '夫婦を削除しました！' : '削除が完了しました！');
            } catch (error) {
                console.error('Delete failed:', error);
                alert('削除に失敗しました: ' + error.message);
            }
        },

        /**
         * 配偶者リンク一括修正（一時的なヘルパー）
         * 使い方: コンソールで app.fixSpouseLinks() を実行
         */
        async fixSpouseLinks() {
            const batch = writeBatch(db);
            let fixCount = 0;

            for (const member of this.allMembers) {
                if (member.spouseId) {
                    const spouse = this.allMembers.find(m => m.id === member.spouseId);
                    if (spouse && spouse.spouseId !== member.id) {
                        console.log(`修正: ${spouse.lastName} ${spouse.firstName} → ${member.lastName} ${member.firstName}`);
                        const spouseRef = doc(db, 'members', spouse.id);
                        batch.update(spouseRef, { spouseId: member.id, updatedAt: new Date() });
                        spouse.spouseId = member.id;
                        fixCount++;
                    }
                }
            }

            if (fixCount > 0) {
                await batch.commit();
                console.log(`✅ ${fixCount}件の配偶者リンクを修正しました！`);
                alert(`${fixCount}件の配偶者リンクを修正しました！`);
            } else {
                console.log('✅ 修正が必要なリンクはありませんでした。');
                alert('すべての配偶者リンクは正常です！');
            }
        },

        /**
         * 配偶者がいてparentIdを持つメンバーの一覧を表示
         * 使い方: コンソールで app.listMarriedWithParent() を実行
         */
        listMarriedWithParent() {
            const results = [];
            for (const member of this.allMembers) {
                if (member.spouseId && member.parentId) {
                    const spouse = this.allMembers.find(m => m.id === member.spouseId);
                    const parent = this.allMembers.find(m => m.id === member.parentId);
                    results.push({
                        id: member.id,
                        name: `${member.lastName} ${member.firstName}`,
                        generation: member.generation,
                        parent: parent ? `${parent.lastName} ${parent.firstName}` : '不明',
                        spouse: spouse ? `${spouse.lastName} ${spouse.firstName}` : '不明'
                    });
                }
            }
            console.table(results);
            console.log('上記の人のうち、婿入り/嫁入りの方のIDをメモして、app.fixMarriedInParent(["id1", "id2", ...]) で修正できます。');
            return results;
        },

        /**
         * 指定したIDの配偶者のparentIdをnullに設定（婿入り/嫁入り修正）
         * 使い方: コンソールで app.fixMarriedInParent(["id1", "id2"]) を実行
         */
        async fixMarriedInParent(memberIds) {
            if (!memberIds || memberIds.length === 0) {
                console.log('修正するメンバーIDを配列で指定してください。');
                console.log('例: app.fixMarriedInParent(["abc123", "def456"])');
                return;
            }

            const batch = writeBatch(db);
            let fixCount = 0;

            for (const memberId of memberIds) {
                const member = this.allMembers.find(m => m.id === memberId);
                if (!member) {
                    console.warn(`ID "${memberId}" のメンバーが見つかりません`);
                    continue;
                }
                console.log(`修正: ${member.lastName} ${member.firstName} のparentIdをnullに設定`);
                const memberRef = doc(db, 'members', memberId);
                batch.update(memberRef, { parentId: null, updatedAt: new Date() });
                member.parentId = null;
                fixCount++;
            }

            if (fixCount > 0) {
                await batch.commit();
                console.log(`✅ ${fixCount}件の婿入り/嫁入りデータを修正しました！`);
                alert(`${fixCount}件の婿入り/嫁入りデータを修正しました！ページをリロードしてください。`);
            } else {
                console.log('修正対象がありませんでした。');
            }
        }
    };
}
