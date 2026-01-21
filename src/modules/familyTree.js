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
        width: 100,
        height: 50,
        rx: 6,           // 角丸
        padding: 8
    },
    // レイアウト
    layout: {
        spouseOffset: 115,   // 配偶者間の距離
        levelHeight: 120,    // 世代間の高さ
        siblingGap: 180      // 兄弟間の距離
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
            const spouseIds = new Set(
                this.allMembers
                    .filter(m => m.spouseId)
                    .map(m => m.spouseId)
            );

            const buildChildren = (parent) => {
                // 配偶者として設定されているメンバーは子ノードから除外
                const children = this.allMembers.filter(m =>
                    m.parentId === parent.id && !spouseIds.has(m.id)
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

            // ツリーレイアウト（動的幅で重なり防止）
            const treeLayout = d3.tree()
                .size([dynamicWidth, height - 120])
                .separation((a, b) => {
                    // 配偶者がいるノードは2.5倍の幅を確保
                    const aHasSpouse = a.data.spouseId ? 2.5 : 1;
                    const bHasSpouse = b.data.spouseId ? 2.5 : 1;
                    // 同じ親の子同士は1.5倍、異なる親の子は2倍
                    return (a.parent === b.parent ? 1.5 : 2) * Math.max(aHasSpouse, bHasSpouse);
                });

            treeLayout(root);

            // 初回のみ中央揃えを設定（更新時はスキップして位置ずれ防止）
            if (!this.treeTransformSet) {
                const rootX = root.x;
                g.attr('transform', `translate(${width / 2 - rootX + 100}, 60)`);
                this.treeTransformSet = true;
            }

            // ===== リンク描画 =====
            const links = g.selectAll('.sesshu-link')
                .data(root.links(), d => d.target.data.id);

            // リンク: Enter（クリックされたノードから出現）
            const linksEnter = links.enter()
                .append('path')
                .attr('class', 'sesshu-link')
                .style('opacity', 0)
                .attr('d', d => {
                    // クリックされたノードの位置から開始
                    const o = { x: sourceNode.x0 ?? sourceNode.x, y: sourceNode.y0 ?? sourceNode.y };
                    return self.diagonalLink(o, o, nodeHeight, spouseOffset, false);
                });

            // リンク: Update + Enter
            links.merge(linksEnter)
                .transition()
                .duration(duration)
                .style('opacity', 0.6)
                .attr('d', d => self.diagonalLink(d.source, d.target, nodeHeight, spouseOffset, d.source.data.spouseId));

            // リンク: Exit（クリックされたノードに戻る）
            links.exit()
                .transition()
                .duration(duration)
                .style('opacity', 0)
                .attr('d', d => {
                    const o = { x: sourceNode.x, y: sourceNode.y };
                    return self.diagonalLink(o, o, nodeHeight, spouseOffset, false);
                })
                .remove();

            // ===== ノード描画 =====
            const nodes = g.selectAll('.sesshu-node-group')
                .data(root.descendants(), d => d.data.id);

            // ノード: Enter（クリックされたノードの位置から出現）
            const nodesEnter = nodes.enter()
                .append('g')
                .attr('class', 'sesshu-node-group')
                .attr('transform', d => {
                    // クリックされたノードの位置から開始
                    const ox = sourceNode.x0 ?? sourceNode.x;
                    const oy = sourceNode.y0 ?? sourceNode.y;
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
                .style('cursor', d => (d.children || d._children) ? 'pointer' : 'default')
                .on('click', function (event, d) {
                    event.stopPropagation();
                    // 子がある（展開可能/折りたたみ可能）場合のみトグル
                    if (d.children || d._children) {
                        self.toggleNode(d);
                        self.updateCollapsibleTree(d);
                    }
                    // 末端ノードは何もしない
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

                    // 展開インジケーター（子がある場合）
                    if (d.children || d._children) {
                        nodeG.append('text')
                            .attr('class', 'sesshu-node__indicator')
                            .attr('x', nodeWidth / 2)
                            .attr('y', nodeHeight + 12)
                            .attr('text-anchor', 'middle')
                            .attr('font-size', '10px')
                            .attr('fill', '#666')
                            .text(d._children ? '▼ 展開' : '▲ 閉じる');
                    }
                });

            // 配偶者の描画
            nodesEnter.each(function (d) {
                if (!d.data.spouseId) return;

                const spouse = self.allMembers.find(m => m.id === d.data.spouseId);
                if (!spouse) return;

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
                    .attr('transform', `translate(${spouseOffset}, 0)`);

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
            });

            // ノード: Update + Enter（位置更新）
            nodes.merge(nodesEnter)
                .transition()
                .duration(duration)
                .attr('transform', d => `translate(${d.x - nodeWidth / 2}, ${d.y - nodeHeight / 2})`)
                .style('opacity', 1);

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
