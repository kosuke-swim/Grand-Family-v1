// familyTree.js - 家系図可視化モジュール
// 「令和の和モダン（Modern Sesshu）」スタイル
// D3.js v7を使用、雪舟の水墨画をモチーフにしたミニマルデザイン
// 折りたたみ式ツリー: タップで枝が伸びていく

import * as d3 from 'd3';

// ===== 和モダン定数 =====
const SESSHU = {
    // カラーパレット
    colors: {
        sumi: '#2F353B',        // 墨色（リンク・枠線）
        washi: '#FDFBF7',       // 和紙色（背景）
        fadeText: '#8B8B8B',    // 故人テキスト
        livingBorder: '#2F353B', // 生存者枠線
        deceasedBorder: '#A0A0A0' // 故人枠線
    },
    // ノードサイズ
    node: {
        width: 80,
        height: 50,
        rx: 6,           // 角丸
        padding: 8
    },
    // レイアウト
    layout: {
        spouseOffset: 100,    // 配偶者間の距離（ノード幅80 + 接続線20）
        levelHeight: 100,    // 世代間の高さ
        siblingGap: 15,      // 末端兄弟間の距離（縮小）
        nodeSpacing: 120     // ノード間の基本間隔
    },
    // アニメーション
    animation: {
        duration: 700
    }
};

export default function familyTreeModule() {
    return {
        // --- State ---
        treeLayout: 'vertical', // 'vertical' | 'horizontal' | 'radial'
        treeInitialized: false,
        svgElement: null,
        zoomBehavior: null,
        treeRoot: null,        // 折りたたみ状態を保持するルートノード
        viewBoxWidth: 1200,    // viewBoxの幅（fitToViewで使用）
        viewBoxHeight: 600,    // viewBoxの高さ

        // --- Methods ---

        /**
         * レイアウト変更
         */
        setTreeLayout(layout) {
            this.treeLayout = layout;
            if (this.treeInitialized) {
                this.treeRoot = null; // レイアウト変更時はリセット
                this.renderTree();
            }
        },

        /**
         * ツリーを初期化して描画
         */
        initTree() {
            if (this.allMembers.length === 0) {
                console.log('No members to display');
                return;
            }

            const container = document.getElementById('family-tree-container');
            if (!container) {
                console.warn('Tree container not found');
                return;
            }

            // コンテナをクリア
            container.innerHTML = '';

            // SVG作成
            const width = container.clientWidth || 1200;
            const height = 600;

            // viewBoxの幅を保存（fitToViewで一貫して使用するため）
            this.viewBoxWidth = width;
            this.viewBoxHeight = height;

            const svg = d3.select(container)
                .append('svg')
                .attr('width', '100%')
                .attr('height', height)
                .attr('viewBox', `0 0 ${width} ${height}`);

            // 筆の尖り用マーカーを定義
            const defs = svg.append('defs');

            // 開始マーカー（下向き三角 = 筆の入り）
            defs.append('marker')
                .attr('id', 'brush-start')
                .attr('viewBox', '0 0 10 10')
                .attr('refX', 5)
                .attr('refY', 0)
                .attr('markerWidth', 4)
                .attr('markerHeight', 4)
                .attr('orient', 'auto')
                .append('path')
                .attr('d', 'M 0 0 L 10 0 L 5 10 Z')
                .attr('fill', '#2F353B')
                .attr('opacity', 0.6);

            // 終了マーカー（上向き三角 = 筆の抜き）
            defs.append('marker')
                .attr('id', 'brush-end')
                .attr('viewBox', '0 0 10 10')
                .attr('refX', 5)
                .attr('refY', 10)
                .attr('markerWidth', 4)
                .attr('markerHeight', 4)
                .attr('orient', 'auto')
                .append('path')
                .attr('d', 'M 0 10 L 10 10 L 5 0 Z')
                .attr('fill', '#2F353B')
                .attr('opacity', 0.6);

            // ズーム用のグループ
            const g = svg.append('g')
                .attr('class', 'tree-group');

            // ズーム・パン設定
            this.zoomBehavior = d3.zoom()
                .scaleExtent([0.3, 3])
                .on('zoom', (event) => {
                    g.attr('transform', event.transform);
                });

            svg.call(this.zoomBehavior);

            this.svgElement = svg;
            this.treeInitialized = true;
            this.treeRoot = null; // 初期化時にリセット
            this.treeTransformSet = false; // transform設定フラグもリセット
            this.renderTree();
        },

        /**
         * ツリーを描画
         */
        renderTree() {
            if (!this.svgElement) return;

            const g = this.svgElement.select('.tree-group');
            g.selectAll('*').remove();

            const hierarchy = this.buildHierarchy();
            if (!hierarchy) {
                g.append('text')
                    .attr('x', 400)
                    .attr('y', 250)
                    .attr('text-anchor', 'middle')
                    .attr('fill', '#666')
                    .style('font-family', "'Noto Serif JP', serif")
                    .text('始祖が見つかりません');
                return;
            }

            const width = 1200;
            const height = 600;

            switch (this.treeLayout) {
                case 'horizontal':
                    this.renderHorizontalTree(g, hierarchy, width, height);
                    break;
                case 'radial':
                    this.renderRadialTree(g, hierarchy, width, height);
                    break;
                default:
                    this.renderCollapsibleTree(g, hierarchy, width, height);
            }
        },

        /**
         * Firestoreのフラットデータを階層構造に変換
         */
        buildHierarchy() {
            // 始祖（generation: 1, parentId: null）を探す
            const root = this.allMembers.find(m => m.generation === 1);
            if (!root) return null;

            // 配偶者として設定されているメンバーのIDリスト（二重表示を防ぐ）
            // ただし、「嫁入り/婿入り」（parentIdがない）配偶者のみを除外対象とする
            // 双方向リンクに対応：両方が除外されないように、parentIdがないものだけを除外
            const spouseIds = new Set();
            for (const m of this.allMembers) {
                if (m.spouseId) {
                    const spouse = this.allMembers.find(s => s.id === m.spouseId);
                    // 配偶者が「嫁入り/婿入り」（parentIdがない）場合のみ除外
                    if (spouse && !spouse.parentId) {
                        spouseIds.add(m.spouseId);
                    }
                }
            }

            const buildChildren = (parent) => {
                // 親の配偶者ID（配偶者経由の子供も検出するため）
                const parentSpouseId = parent.spouseId || null;

                // 配偶者として設定されているメンバーは子ノードから除外
                // 親 または 親の配偶者 を parentId として持つメンバーを子として取得
                const children = this.allMembers.filter(m =>
                    (m.parentId === parent.id || (parentSpouseId && m.parentId === parentSpouseId)) &&
                    !spouseIds.has(m.id)
                );
                if (children.length === 0) return null;

                // 日本式ソート：右が年長（長男/長女）
                children.sort((a, b) => {
                    const dateA = a.birthDate ? new Date(a.birthDate) : null;
                    const dateB = b.birthDate ? new Date(b.birthDate) : null;

                    if (!dateA && !dateB) return 0;
                    if (!dateA) return -1;
                    if (!dateB) return 1;

                    return dateB - dateA;
                });

                return children.map(child => ({
                    ...child,
                    children: buildChildren(child)
                }));
            };

            return {
                ...root,
                children: buildChildren(root)
            };
        },

        /**
         * ノードラベルを取得
         */
        getNodeLabel(d) {
            return `${d.data.lastName} ${d.data.firstName}`;
        },

        /**
         * ノードの展開/折りたたみを切り替え
         */
        toggleNode(d) {
            if (d.children) {
                // 折りたたむ: childrenを_childrenに退避
                d._children = d.children;
                d.children = null;
            } else if (d._children) {
                // 展開する: _childrenをchildrenに復元
                d.children = d._children;
                d._children = null;
            }
        },

        /**
         * 初期状態で全てのノードを折りたたむ（ルートのみ表示）
         */
        collapseAll(node) {
            if (node.children) {
                node._children = node.children;
                node._children.forEach(child => this.collapseAll(child));
                node.children = null;
            }
        },

        /**
         * 全てのノードを展開する
         */
        expandAll(node) {
            if (node._children) {
                node.children = node._children;
                node._children = null;
            }
            if (node.children) {
                node.children.forEach(child => this.expandAll(child));
            }
        },

        /**
         * 指定した深さのノードを展開する
         */
        expandLevel(node, targetDepth, currentDepth = 0) {
            if (currentDepth === targetDepth) {
                // 目標の深さに達したら展開
                if (node._children) {
                    node.children = node._children;
                    node._children = null;
                }
            } else if (node.children) {
                // まだ目標深さに達していない場合は子を再帰的に探索
                node.children.forEach(child =>
                    this.expandLevel(child, targetDepth, currentDepth + 1)
                );
            }
        },

        /**
         * ツリーの最大深さを取得
         */
        getMaxDepth(node, currentDepth = 0) {
            if (!node._children && !node.children) {
                return currentDepth;
            }
            const children = node.children || node._children || [];
            if (children.length === 0) return currentDepth;

            return Math.max(...children.map(child =>
                this.getMaxDepth(child, currentDepth + 1)
            ));
        },

        /**
         * 展開アニメーション中かどうか
         */
        isExpandAnimating: false,

        /**
         * 展開/折りたたみトグル状態
         */
        isAllExpanded: false,

        /**
         * 全て展開/折りたたみをトグル（カスケードアニメーション）
         */
        toggleExpandAll() {
            if (!this.treeRoot) return;
            if (this.isExpandAnimating) return; // アニメーション中は無視

            if (this.isAllExpanded) {
                // 折りたたむ（ルートの子だけ残す）
                if (this.treeRoot.children) {
                    this.treeRoot.children.forEach(child => this.collapseAll(child));
                }
                this.isAllExpanded = false;
                this.updateCollapsibleTree(this.treeRoot);
                // 折りたたみ後も中央に配置
                setTimeout(() => this.fitToView(), SESSHU.animation.duration + 100);
            } else {
                // 世代ごとに順次展開
                this.expandByLevelCascade();
            }
        },

        /**
         * 世代ごとに順次展開するカスケードアニメーション
         */
        expandByLevelCascade() {
            const maxDepth = this.getMaxDepth(this.treeRoot);
            const delayPerLevel = SESSHU.animation.duration + 800; // 各世代間の遅延（fitToView含む、ゆっくり展開）

            this.isExpandAnimating = true;

            // 各世代を順次展開
            for (let depth = 0; depth <= maxDepth; depth++) {
                setTimeout(() => {
                    this.expandLevel(this.treeRoot, depth);
                    this.updateCollapsibleTree(this.treeRoot);

                    // 各展開後にズームを調整して全体が見えるようにする
                    setTimeout(() => this.fitToView(), SESSHU.animation.duration + 50);

                    // 最後の世代が完了したら
                    if (depth === maxDepth) {
                        this.isAllExpanded = true;
                        this.isExpandAnimating = false;
                    }
                }, depth * delayPerLevel);
            }
        },

        /**
         * ツリー全体が見えるようにズームを調整（始祖を中央に配置）
         */
        fitToView() {
            if (!this.svgElement || !this.treeRoot || !this.zoomBehavior) return;

            const g = this.svgElement.select('.tree-group');
            const bounds = g.node().getBBox();

            // viewBoxの幅を使用（initTreeで設定した値と一致させる）
            const fullWidth = this.viewBoxWidth || 1200;
            const fullHeight = this.viewBoxHeight || 600;

            const width = bounds.width;
            const height = bounds.height;

            if (width === 0 || height === 0) return;

            // パディングを含めたスケール計算（ツリー全体が収まるように）
            const scale = 0.85 / Math.max(width / fullWidth, height / fullHeight);
            const clampedScale = Math.min(Math.max(scale, 0.3), 1.5);

            // 始祖の位置を取得（配偶者がいる場合は中央を計算）
            const rootX = this.treeRoot.x;
            const rootY = this.treeRoot.y;
            const spouseOffset = this.treeRoot.data.spouseId ? SESSHU.layout.spouseOffset / 2 : 0;
            const rootCenterX = rootX + spouseOffset;

            // 始祖をコンテナの横幅中央に配置、縦はバウンディングボックスを考慮
            const boundsCenterY = bounds.y + height / 2;
            const translate = [
                fullWidth / 2 - rootCenterX * clampedScale,
                fullHeight / 2 - boundsCenterY * clampedScale
            ];

            const transform = d3.zoomIdentity
                .translate(translate[0], translate[1])
                .scale(clampedScale);

            this.svgElement.transition()
                .duration(500)
                .call(this.zoomBehavior.transform, transform);
        },

        /**
         * ズームイン
         */
        zoomIn() {
            if (!this.svgElement || !this.zoomBehavior) return;
            this.svgElement.transition()
                .duration(300)
                .call(this.zoomBehavior.scaleBy, 1.3);
        },

        /**
         * ズームアウト
         */
        zoomOut() {
            if (!this.svgElement || !this.zoomBehavior) return;
            this.svgElement.transition()
                .duration(300)
                .call(this.zoomBehavior.scaleBy, 0.7);
        },

        /**
         * ズームをリセット（始祖を中央に表示）
         */
        resetZoom() {
            if (!this.svgElement || !this.zoomBehavior || !this.treeRoot) return;

            const fullWidth = this.viewBoxWidth || 1200;
            const spouseOffset = this.treeRoot.data.spouseId ? SESSHU.layout.spouseOffset / 2 : 0;
            const rootCenterX = this.treeRoot.x + spouseOffset;

            const transform = d3.zoomIdentity.translate(fullWidth / 2 - rootCenterX, 60);
            this.svgElement.transition()
                .duration(500)
                .call(this.zoomBehavior.transform, transform);
        },

        /**
         * メンバー詳細をポップオーバーで表示
         */
        showMemberDetails(memberData, event) {
            // 既存のポップオーバーを削除
            this.hideDetailPopover();

            const member = memberData;
            const age = this.calculateAge ?
                this.calculateAge(member.birthDate, member.registry === 'tengoku' ? member.passedAt : null) :
                '不明';

            const popover = document.createElement('div');
            popover.className = 'tree-detail-popover';
            popover.innerHTML = `
                <button class="close-btn" onclick="this.parentElement.remove()">×</button>
                <h5>${member.lastName} ${member.firstName}</h5>
                ${member.romanizedName ? `
                <div style="font-family: 'Times New Roman', serif; font-size: 0.85rem; font-style: italic; color: #666; margin-bottom: 8px;">
                    ${member.romanizedName}
                </div>
                ` : ''}
                <div class="detail-row">
                    <span class="detail-label">世代</span>
                    <span>第${member.generation}世代</span>
                </div>
                ${member.birthDate ? `
                <div class="detail-row">
                    <span class="detail-label">生年月日</span>
                    <span>${member.birthDate}</span>
                </div>
                ` : ''}
                <div class="detail-row">
                    <span class="detail-label">${member.registry === 'tengoku' ? '享年' : '年齢'}</span>
                    <span>${age}歳</span>
                </div>
                ${member.registry === 'tengoku' && member.passedAt ? `
                <div class="detail-row">
                    <span class="detail-label">没年月日</span>
                    <span>${member.passedAt}</span>
                </div>
                ` : ''}
            `;

            document.body.appendChild(popover);

            // 位置調整
            const rect = event.target.getBoundingClientRect();
            popover.style.left = `${rect.left + rect.width / 2 - popover.offsetWidth / 2}px`;
            popover.style.top = `${rect.bottom + 12}px`;

            // 画面外にはみ出る場合の調整
            const popRect = popover.getBoundingClientRect();
            if (popRect.right > window.innerWidth) {
                popover.style.left = `${window.innerWidth - popRect.width - 16}px`;
            }
            if (popRect.left < 0) {
                popover.style.left = '16px';
            }

            // クリック外で閉じる
            setTimeout(() => {
                document.addEventListener('click', this.hideDetailPopover, { once: true });
            }, 100);
        },

        /**
         * 詳細ポップオーバーを非表示
         */
        hideDetailPopover() {
            const existing = document.querySelector('.tree-detail-popover');
            if (existing) existing.remove();
        },
        /**
         * 折りたたみ式縦型ツリー描画
         */
        renderCollapsibleTree(g, hierarchyData, width, height) {
            const self = this;
            const nodeWidth = SESSHU.node.width;
            const nodeHeight = SESSHU.node.height;
            const spouseOffset = SESSHU.layout.spouseOffset;
            const duration = SESSHU.animation.duration;

            // 既存のルートがなければ新規作成して折りたたむ
            if (!this.treeRoot) {
                this.treeRoot = d3.hierarchy(hierarchyData);
                // 始祖以外を全て折りたたむ
                if (this.treeRoot.children) {
                    this.treeRoot.children.forEach(child => this.collapseAll(child));
                }
                // 各ノードに初期位置を記録
                this.treeRoot.x0 = 0;
                this.treeRoot.y0 = 0;
            }

            const root = this.treeRoot;

            // クリックされたノードの位置（アニメーション起点）
            const sourceNode = this.clickedNode || root;

            // ===== 動的幅計算: 表示ノード数に応じて調整 =====
            const visibleNodes = root.descendants();
            const nodeCount = visibleNodes.length;
            const spouseCount = visibleNodes.filter(n => n.data.spouseId).length;

            // ノード幅(100) + 配偶者オフセット(115) + 余白
            const minWidth = 300;
            const perNodeWidth = 100;
            const perSpouseWidth = 100;
            const dynamicWidth = Math.max(minWidth, nodeCount * perNodeWidth + spouseCount * perSpouseWidth);

            // ===== カスタムボトムアップレイアウト =====
            // 末端を詰めて配置し、親は子の中央に配置
            this.applyBottomUpLayout(root);

            // 初回のみ中央揃えを設定（更新時はスキップして位置ずれ防止）
            if (!this.treeTransformSet) {
                const rootX = root.x;
                // 始祖に配偶者がいる場合、配偶者を含めた中心点を計算
                const rootSpouseOffset = root.data.spouseId ? spouseOffset / 2 : 0;
                const rootCenterX = rootX + rootSpouseOffset;
                const initialTransform = d3.zoomIdentity.translate(width / 2 - rootCenterX, 60);
                // ズームビヘイビアに初期位置を同期させる
                this.svgElement.call(this.zoomBehavior.transform, initialTransform);
                this.treeTransformSet = true;
            }

            // ===== リンク描画 =====
            const links = g.selectAll('.sesshu-link')
                .data(root.links(), d => d.target.data.id);

            // リンク: Enter（親ノードから出現）
            const linksEnter = links.enter()
                .append('path')
                .attr('class', 'sesshu-link')
                .style('opacity', 0)
                .attr('d', d => {
                    // 親ノードの位置から開始（配偶者がいる場合は中間点）
                    const parent = d.source;
                    const parentX = parent.data.spouseId ? parent.x + spouseOffset / 2 : parent.x;
                    const o = { x: parentX, y: parent.y0 ?? parent.y };
                    return self.diagonalLink({ x: parentX, y: parent.y }, { x: parentX, y: parent.y }, nodeHeight, spouseOffset, false);
                });

            // リンク: Update + Enter
            links.merge(linksEnter)
                .transition()
                .duration(duration)
                .style('opacity', 0.6)
                .attr('d', d => self.diagonalLink(d.source, d.target, nodeHeight, spouseOffset, d.source.data.spouseId));

            // リンク: Exit（親ノードに戻る）
            links.exit()
                .transition()
                .duration(duration)
                .style('opacity', 0)
                .attr('d', d => {
                    // 親ノードの位置に戻る
                    const parent = d.source;
                    const parentX = parent.data.spouseId ? parent.x + spouseOffset / 2 : parent.x;
                    return self.diagonalLink({ x: parentX, y: parent.y }, { x: parentX, y: parent.y }, nodeHeight, spouseOffset, false);
                })
                .remove();

            // ===== ノード描画 =====
            const nodes = g.selectAll('.sesshu-node-group')
                .data(root.descendants(), d => d.data.id);

            // ノード: Enter（親ノードの位置から出現）
            const nodesEnter = nodes.enter()
                .append('g')
                .attr('class', 'sesshu-node-group')
                .attr('transform', d => {
                    // 親ノードの位置から開始（配偶者がいる場合は中間点）
                    const parent = d.parent || d;
                    const parentX = parent.data.spouseId ? parent.x + spouseOffset / 2 : parent.x;
                    const ox = parent.x0 ?? parentX;
                    const oy = parent.y0 ?? parent.y;
                    return `translate(${ox - nodeWidth / 2}, ${oy - nodeHeight / 2})`;
                })
                .style('opacity', 0);

            // ノードグループ（クリック領域）
            nodesEnter.append('g')
                .attr('class', d => {
                    const stateClass = d.data.registry === 'tengoku'
                        ? 'sesshu-node sesshu-node--deceased'
                        : 'sesshu-node sesshu-node--living';
                    return stateClass;
                })
                .style('cursor', 'pointer')
                .on('click', function (event, d) {
                    event.stopPropagation();
                    // ノード本体クリックで詳細を表示
                    self.showMemberDetails(d.data, event);
                })
                .each(function (d) {
                    const nodeG = d3.select(this);

                    // 背景
                    nodeG.append('rect')
                        .attr('class', 'sesshu-node__bg')
                        .attr('width', nodeWidth)
                        .attr('height', nodeHeight)
                        .attr('rx', SESSHU.node.rx)
                        .attr('ry', SESSHU.node.rx);

                    // 姓
                    nodeG.append('text')
                        .attr('class', 'sesshu-node__label')
                        .attr('x', nodeWidth / 2)
                        .attr('y', 18)
                        .attr('text-anchor', 'middle')
                        .attr('font-size', '10px')
                        .text(d.data.lastName);

                    // 名
                    nodeG.append('text')
                        .attr('class', 'sesshu-node__name')
                        .attr('x', nodeWidth / 2)
                        .attr('y', 36)
                        .attr('text-anchor', 'middle')
                        .attr('font-size', '14px')
                        .text(d.data.firstName);

                    // 故人には羽アイコン
                    if (d.data.registry === 'tengoku') {
                        nodeG.append('text')
                            .attr('class', 'sesshu-node__angel')
                            .attr('x', nodeWidth - 5)
                            .attr('y', 12)
                            .attr('text-anchor', 'end')
                            .attr('font-size', '10px')
                            .text('🕊️');
                    }
                });

            // 展開/折りたたみボタン（円形の+/-）- 子がある場合のみ
            nodesEnter.each(function (d) {
                if (!d.children && !d._children) return;

                const nodeG = d3.select(this);
                const btnSize = 20;
                const btnY = nodeHeight + 8;

                const expandBtn = nodeG.append('g')
                    .attr('class', 'sesshu-expand-btn')
                    .attr('transform', `translate(${nodeWidth / 2}, ${btnY})`)
                    .style('cursor', 'pointer')
                    .on('click', function (event) {
                        event.stopPropagation();
                        self.toggleNode(d);
                        self.updateCollapsibleTree(d);
                    });

                // 円形背景
                expandBtn.append('circle')
                    .attr('r', btnSize / 2)
                    .attr('fill', 'white')
                    .attr('stroke', '#ccc')
                    .attr('stroke-width', 1.5);

                // +/- アイコン
                expandBtn.append('text')
                    .attr('text-anchor', 'middle')
                    .attr('dominant-baseline', 'central')
                    .attr('font-size', '14px')
                    .attr('font-weight', 'bold')
                    .attr('fill', '#666')
                    .text(d._children ? '+' : '−');
            });

            // 配偶者の描画（嫁入り/婿入りの配偶者のみ）
            nodesEnter.each(function (d) {
                if (!d.data.spouseId) return;

                const spouse = self.allMembers.find(m => m.id === d.data.spouseId);
                if (!spouse) return;

                // 配偶者がparentIdを持っている場合は、すでにツリーに表示されているのでスキップ
                // （嫁入り/婿入りでparentIdがない配偶者のみ横に描画）
                if (spouse.parentId) return;

                const nodeG = d3.select(this);

                // 配偶者との接続線
                nodeG.append('line')
                    .attr('class', 'sesshu-link--spouse')
                    .attr('x1', nodeWidth)
                    .attr('y1', nodeHeight / 2)
                    .attr('x2', spouseOffset)
                    .attr('y2', nodeHeight / 2);

                // 配偶者ノード
                const spouseG = nodeG.append('g')
                    .attr('class', spouse.registry === 'tengoku'
                        ? 'sesshu-node sesshu-node--deceased'
                        : 'sesshu-node sesshu-node--living')
                    .attr('transform', `translate(${spouseOffset}, 0)`)
                    .style('cursor', 'pointer')
                    .on('click', function (event) {
                        event.stopPropagation();
                        self.showMemberDetails(spouse, event);
                    });

                spouseG.append('rect')
                    .attr('class', 'sesshu-node__bg')
                    .attr('width', nodeWidth)
                    .attr('height', nodeHeight)
                    .attr('rx', SESSHU.node.rx);

                spouseG.append('text')
                    .attr('class', 'sesshu-node__label')
                    .attr('x', nodeWidth / 2)
                    .attr('y', 18)
                    .attr('text-anchor', 'middle')
                    .attr('font-size', '10px')
                    .text(spouse.lastName);

                spouseG.append('text')
                    .attr('class', 'sesshu-node__name')
                    .attr('x', nodeWidth / 2)
                    .attr('y', 36)
                    .attr('text-anchor', 'middle')
                    .attr('font-size', '14px')
                    .text(spouse.firstName);

                // 故人には羽アイコン
                if (spouse.registry === 'tengoku') {
                    spouseG.append('text')
                        .attr('class', 'sesshu-node__angel')
                        .attr('x', nodeWidth - 5)
                        .attr('y', 12)
                        .attr('text-anchor', 'end')
                        .attr('font-size', '10px')
                        .text('🕊️');
                }
            });

            // ノード: Update + Enter（位置更新）
            nodes.merge(nodesEnter)
                .transition()
                .duration(duration)
                .attr('transform', d => `translate(${d.x - nodeWidth / 2}, ${d.y - nodeHeight / 2})`)
                .style('opacity', 1);

            // 既存ノードの+/-ボタンテキストを更新
            nodes.merge(nodesEnter).each(function (d) {
                const nodeG = d3.select(this);
                const expandBtn = nodeG.select('.sesshu-expand-btn text');
                if (!expandBtn.empty()) {
                    expandBtn.text(d._children ? '+' : '−');
                }
            });

            // ノード: Exit（クリックされたノードに戻る）
            nodes.exit()
                .transition()
                .duration(duration)
                .attr('transform', d => {
                    return `translate(${sourceNode.x - nodeWidth / 2}, ${sourceNode.y - nodeHeight / 2})`;
                })
                .style('opacity', 0)
                .remove();

            // 各ノードの位置を保存（次回のアニメーション用）
            root.descendants().forEach(d => {
                d.x0 = d.x;
                d.y0 = d.y;
            });

            // クリックノードをリセット
            this.clickedNode = null;
        },

        /**
         * 折りたたみツリーを更新（トグル後に彼び出し）
         */
        updateCollapsibleTree(clickedNode) {
            if (!this.svgElement || !this.treeRoot) return;

            // クリックされたノードを保存（アニメーション起点）
            this.clickedNode = clickedNode;

            const g = this.svgElement.select('.tree-group');
            const width = 1200;
            const height = 600;

            // クリアせずに部分更新
            this.renderCollapsibleTree(g, null, width, height);
        },

        /**
         * Bezier曲線パスを生成
         */
        diagonalLink(source, target, nodeHeight, spouseOffset, hasSpouse) {
            const startX = hasSpouse ? source.x + spouseOffset / 2 : source.x;
            // インジケーター（nodeHeight + 12）より下から開始
            const startY = source.y + nodeHeight / 2 + 25;
            const endX = target.x;
            const endY = target.y - nodeHeight / 2 - 5;
            const midY = (startY + endY) / 2;

            return `M ${startX} ${startY}
                    C ${startX} ${midY},
                      ${endX} ${midY},
                      ${endX} ${endY}`;
        },

        /**
         * ボトムアップレイアウト: 末端を詰めて配置し、親は子の中央に
         */
        applyBottomUpLayout(root) {
            const nodeWidth = SESSHU.node.width;
            const spouseOffset = SESSHU.layout.spouseOffset;
            const levelHeight = SESSHU.layout.levelHeight;
            const siblingGap = SESSHU.layout.siblingGap;

            let currentX = 0;

            // 再帰的にサブツリーの幅を計算し、座標を設定
            const calculatePositions = (node, depth) => {
                node.y = depth * levelHeight;

                if (!node.children || node.children.length === 0) {
                    // 末端ノード: 現在のX位置に配置
                    const nodeFullWidth = node.data.spouseId
                        ? nodeWidth + spouseOffset
                        : nodeWidth;

                    node.x = currentX + nodeFullWidth / 2;
                    currentX += nodeFullWidth + siblingGap;

                    return { left: node.x - nodeFullWidth / 2, right: node.x + nodeFullWidth / 2 };
                }

                // 子ノードの位置を先に計算
                let leftMost = Infinity;
                let rightMost = -Infinity;

                node.children.forEach(child => {
                    const bounds = calculatePositions(child, depth + 1);
                    leftMost = Math.min(leftMost, bounds.left);
                    rightMost = Math.max(rightMost, bounds.right);
                });

                // 親は子の中央に配置
                const nodeFullWidth = node.data.spouseId
                    ? nodeWidth + spouseOffset
                    : nodeWidth;

                node.x = (leftMost + rightMost) / 2;

                // 親の幅を考慮してboundsを返す
                const parentLeft = node.x - nodeFullWidth / 2;
                const parentRight = node.x + nodeFullWidth / 2;

                return {
                    left: Math.min(leftMost, parentLeft),
                    right: Math.max(rightMost, parentRight)
                };
            };

            calculatePositions(root, 0);
        },

        /**
         * 横型ツリー描画（シンプル版・和モダン適用）
         */
        renderHorizontalTree(g, hierarchyData, width, height) {
            const root = d3.hierarchy(hierarchyData);
            const self = this;
            const treeLayout = d3.tree().size([height - 100, width - 250]);
            treeLayout(root);

            g.attr('transform', 'translate(100, 50)');

            const nodeWidth = SESSHU.node.width;
            const nodeHeight = SESSHU.node.height;

            // リンク
            g.selectAll('.sesshu-link')
                .data(root.links())
                .enter()
                .append('path')
                .attr('class', 'sesshu-link')
                .attr('d', d3.linkHorizontal()
                    .x(d => d.y)
                    .y(d => d.x));

            // ノード
            const nodes = g.selectAll('.sesshu-node')
                .data(root.descendants())
                .enter()
                .append('g')
                .attr('class', d => {
                    const stateClass = d.data.registry === 'tengoku'
                        ? 'sesshu-node--deceased'
                        : 'sesshu-node--living';
                    return `sesshu-node ${stateClass}`;
                })
                .attr('transform', d => `translate(${d.y - nodeWidth / 2}, ${d.x - nodeHeight / 2})`)
                .style('cursor', 'pointer')
                .on('click', function (event, d) {
                    event.stopPropagation();
                    self.openEditMember(d.data);
                });

            nodes.append('rect')
                .attr('class', 'sesshu-node__bg')
                .attr('width', nodeWidth)
                .attr('height', nodeHeight)
                .attr('rx', SESSHU.node.rx);

            nodes.append('text')
                .attr('class', 'sesshu-node__label')
                .attr('x', nodeWidth / 2)
                .attr('y', 18)
                .attr('text-anchor', 'middle')
                .attr('font-size', '10px')
                .text(d => d.data.lastName);

            nodes.append('text')
                .attr('class', 'sesshu-node__name')
                .attr('x', nodeWidth / 2)
                .attr('y', 36)
                .attr('text-anchor', 'middle')
                .attr('font-size', '14px')
                .text(d => d.data.firstName);
        },

        /**
         * ラジアルツリー描画（シンプル版・和モダン適用）
         */
        renderRadialTree(g, hierarchyData, width, height) {
            const root = d3.hierarchy(hierarchyData);
            const self = this;
            const radius = Math.min(width, height) / 2 - 80;

            const treeLayout = d3.tree()
                .size([2 * Math.PI, radius])
                .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth);

            treeLayout(root);

            g.attr('transform', `translate(${width / 2}, ${height / 2})`);

            g.selectAll('.sesshu-link')
                .data(root.links())
                .enter()
                .append('path')
                .attr('class', 'sesshu-link')
                .attr('d', d3.linkRadial()
                    .angle(d => d.x)
                    .radius(d => d.y));

            const nodes = g.selectAll('.sesshu-node')
                .data(root.descendants())
                .enter()
                .append('g')
                .attr('class', d => {
                    const stateClass = d.data.registry === 'tengoku'
                        ? 'sesshu-node--deceased'
                        : 'sesshu-node--living';
                    return `sesshu-node ${stateClass}`;
                })
                .attr('transform', d => `
                    rotate(${d.x * 180 / Math.PI - 90})
                    translate(${d.y}, 0)
                `)
                .style('cursor', 'pointer')
                .on('click', function (event, d) {
                    event.stopPropagation();
                    self.openEditMember(d.data);
                });

            nodes.append('circle')
                .attr('class', 'sesshu-node__bg')
                .attr('r', 25);

            nodes.append('text')
                .attr('class', 'sesshu-node__name')
                .attr('dy', 4)
                .attr('text-anchor', 'middle')
                .attr('font-size', '10px')
                .attr('transform', d => d.x >= Math.PI ? 'rotate(180)' : null)
                .text(d => d.data.firstName);
        }
    };
}
