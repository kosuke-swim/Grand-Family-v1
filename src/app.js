// app.js - メインStateオブジェクト + Alpine.data定義
// Fitness-v4のアーキテクチャに準拠: 単一Stateオブジェクト + Spread構文でモジュールをマージ

import Alpine from 'alpinejs';
import { db } from './firebase.js';
import adminModule from './modules/admin.js';
import familyTreeModule from './modules/familyTree.js';

// ★ 重要: dbはリアクティブデータの外に保持（循環参照問題を回避）
const firebaseDb = db;

Alpine.data('mainApp', () => {
    const adminData = adminModule();
    const treeData = familyTreeModule();

    return {
        // 現在のビュー
        currentView: 'magomago', // 'magomago' | 'tengoku' | 'tree'

        // 選択中の枝番（null = 全て表示）
        selectedBranchId: null,

        // 検索クエリ
        searchQuery: '',

        // 親検索用
        parentSearchQuery: '',
        showParentDropdown: false,

        // 成功メッセージ用
        successMessage: '',

        // 各モジュールをSpread構文でマージ
        ...adminData,
        ...treeData,

        // --- Computed Properties ---

        /**
         * フォームバリデーション（adminModuleのgetterはspreadでリアクティブにならないため、ここで定義）
         */
        get isFormValid() {
            const m = this.newMember;
            // 必須: 姓、名、親、世代、枝番
            return !!(
                m.firstName &&
                m.lastName &&
                m.parentId &&
                m.generation &&
                m.branchId
            );
        },

        /**
         * まごまご会（全員：故人含む）のフィルタ済みリスト
         */
        get filteredMagomagoMembers() {
            return this.allMembers
                .filter((m) => {
                    if (!this.searchQuery) return true;
                    const fullName = `${m.lastName}${m.firstName}`.toLowerCase();
                    return fullName.includes(this.searchQuery.toLowerCase());
                });
        },

        /**
         * 天国会（故人）のリスト
         */
        get tengokuMembers() {
            return this.allMembers.filter((m) => m.registry === 'tengoku');
        },

        /**
         * 枝番ごとにグループ化したメンバーリスト（家系の深さ優先順）
         */
        get membersByBranch() {
            const filtered = this.filteredMagomagoMembers;
            const allMembersList = this.allMembers;
            const grouped = {};

            // 存在する枝番のみをグループ化
            for (const member of filtered) {
                const branchId = member.branchId || 0; // null/undefinedは0（始祖）として扱う
                if (!grouped[branchId]) {
                    grouped[branchId] = [];
                }
                grouped[branchId].push(member);
            }

            /**
             * 深さ優先でメンバーをソート
             * @param {Array} members - 枝番内のメンバーリスト
             * @returns {Array} - ソート済みメンバーリスト
             */
            const sortByFamilyTree = (members) => {
                const result = [];
                const visited = new Set();
                const memberMap = new Map(members.map(m => [m.id, m]));
                const allMembersMap = new Map(allMembersList.map(m => [m.id, m]));

                // 双方向の配偶者マップを構築
                // キー: 人のID, 値: その人の配偶者のID
                const spouseMap = new Map();
                for (const m of members) {
                    if (m.spouseId) {
                        spouseMap.set(m.id, m.spouseId);
                        spouseMap.set(m.spouseId, m.id); // 逆方向も登録
                    }
                }

                /**
                 * その人が「嫁入り/婿入り」配偶者かどうか判定
                 * 条件: 誰かの配偶者であり、かつ自分の親が配偶者の親と同じ（または親がいない）
                 */
                const isMarriedInSpouse = (person) => {
                    const partnerId = spouseMap.get(person.id);
                    if (!partnerId) return false;

                    const partner = memberMap.get(partnerId) || allMembersMap.get(partnerId);
                    if (!partner) return false;

                    // パートナーに親がいて、自分に親がいない → 嫁入り/婿入り
                    if (partner.parentId && !person.parentId) return true;

                    // 両方に親がいる場合、パートナーの親がこの枝番のメンバーで、自分の親がパートナーの親と同じ → 嫁入り/婿入り
                    if (partner.parentId && person.parentId) {
                        const partnerParent = allMembersMap.get(partner.parentId);
                        // 自分の親がパートナーの祖先（または同じ）の場合は嫁入り
                        if (partnerParent && partnerParent.branchId === person.branchId) {
                            // パートナーの親の系列にいる場合、自分は嫁入り扱い
                            if (person.parentId === partner.parentId) {
                                // 同じ親を持つ = 兄弟なので、spouseIdを持っていない方が嫁入り
                                return !person.spouseId && spouseMap.has(person.id);
                            }
                        }
                    }

                    return false;
                };

                /**
                 * 配偶者を持っているか（双方向チェック）
                 */
                const hasSpouse = (person) => {
                    return spouseMap.has(person.id);
                };

                /**
                 * 配偶者を取得（双方向）
                 */
                const getSpouse = (person) => {
                    const spouseId = spouseMap.get(person.id);
                    return spouseId ? memberMap.get(spouseId) : null;
                };

                // その枝番のルート（最も世代が上の人）を見つける
                // 条件: 嫁入り/婿入り配偶者ではない かつ parentIdがこの枝番内にいない
                const roots = members.filter(m => {
                    // 嫁入り/婿入り配偶者はルートから除外
                    if (isMarriedInSpouse(m)) return false;

                    if (!m.parentId) return true;
                    const parent = allMembersMap.get(m.parentId);
                    // 親がいない、または親が別の枝番の場合はルート
                    return !parent || parent.branchId !== m.branchId;
                }).sort((a, b) => a.generation - b.generation);

                /**
                 * 再帰的に本人 → 配偶者 → 子供たちを追加
                 */
                const addPersonAndDescendants = (person) => {
                    if (visited.has(person.id)) return;
                    visited.add(person.id);

                    // フィルタ済みリストに含まれている場合のみ追加
                    if (memberMap.has(person.id)) {
                        result.push(person);
                    }

                    // 配偶者を追加（まだ追加されていない場合）
                    const spouse = getSpouse(person);
                    if (spouse && !visited.has(spouse.id)) {
                        visited.add(spouse.id);
                        result.push(spouse);
                    }

                    // 子供たちを取得
                    // 条件: この人またはその配偶者を親に持つ人で、嫁入り/婿入り配偶者ではない
                    const spouseId = spouseMap.get(person.id);
                    const children = members.filter(m => {
                        if (visited.has(m.id)) return false;
                        // 嫁入り/婿入り配偶者は子供リストから除外（パートナーの配偶者として追加される）
                        if (isMarriedInSpouse(m)) return false;
                        // この人またはその配偶者を親に持つ
                        return m.parentId === person.id || (spouseId && m.parentId === spouseId);
                    }).sort((a, b) => {
                        // 配偶者がいる人は後ろに配置
                        const aHasSpouse = hasSpouse(a);
                        const bHasSpouse = hasSpouse(b);
                        if (aHasSpouse !== bHasSpouse) {
                            return aHasSpouse ? 1 : -1; // 配偶者ありを後ろに
                        }
                        // 生年月日でソート、なければIDでソート
                        if (a.birthDate && b.birthDate) {
                            return a.birthDate.localeCompare(b.birthDate);
                        }
                        return (a.id || '').localeCompare(b.id || '');
                    });

                    // 子供ごとに再帰
                    for (const child of children) {
                        addPersonAndDescendants(child);
                    }
                };

                // 各ルートから深さ優先で追加
                for (const root of roots) {
                    addPersonAndDescendants(root);
                }

                // 訪問されなかったメンバーを末尾に追加（念のため）
                for (const member of members) {
                    if (!visited.has(member.id)) {
                        result.push(member);
                    }
                }

                return result;
            };

            // 枝番順にソートして配列として返す
            return Object.entries(grouped)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([branchId, members]) => ({
                    branchId: Number(branchId),
                    branchName: this.branchLabels[branchId] || '始祖',
                    members: sortByFamilyTree(members)
                }));
        },

        /**
         * 親候補のフィルタ済みリスト（インクリメンタル検索用）
         */
        get filteredParentCandidates() {
            if (!this.parentSearchQuery) return [];
            const query = this.parentSearchQuery.toLowerCase();
            return this.allMembers.filter((m) => {
                const fullName = `${m.lastName}${m.firstName}`.toLowerCase();
                return fullName.includes(query);
            });
        },

        // --- Methods ---

        /**
         * 親を選択
         */
        selectParent(member) {
            this.newMember.parentId = member.id;
            this.parentSearchQuery = '';
            this.showParentDropdown = false;
            this.onParentSelect(); // 世代・枝番を自動計算
        },

        /**
         * 親選択を解除
         */
        clearParentSelection() {
            this.newMember.parentId = '';
            this.newMember.generation = null;
            this.newMember.branchId = null;
            this.selectedParentGeneration = null;
            this.parentSearchQuery = '';
        },

        /**
         * 親の表示名を取得
         */
        getParentDisplayName(parentId) {
            const parent = this.allMembers.find((m) => m.id === parentId);
            if (!parent) return '';
            return `${parent.lastName} ${parent.firstName} (第${parent.generation}世代 - ${this.branchLabels[parent.branchId] || '始祖'})`;
        },

        /**
         * Firestoreへのアクセサ（リアクティブ外）
         */
        getDb() {
            return firebaseDb;
        },

        /**
         * 成功モーダルを表示
         */
        showSuccessModal(message) {
            this.successMessage = message;
            const modal = new bootstrap.Modal(document.getElementById('successModal'));
            modal.show();
        },

        /**
         * 年齢計算（享年計算用）
         */
        calculateAge(birthDate, endDate) {
            if (!birthDate) return '不明';

            const birth = new Date(birthDate);
            const end = endDate ? new Date(endDate) : new Date();

            let age = end.getFullYear() - birth.getFullYear();
            const monthDiff = end.getMonth() - birth.getMonth();

            if (monthDiff < 0 || (monthDiff === 0 && end.getDate() < birth.getDate())) {
                age--;
            }

            return age;
        },

        /**
         * 初期化
         */
        async init() {
            console.log('Grand-Family App init() called');
            try {
                await this.fetchAllMembers();
                console.log('init complete, allMembers:', this.allMembers.length);
            } catch (error) {
                console.error('init error:', error);
            }
        }
    };
});

export default Alpine;
