---
name: cocos-creator-ui-list
description: 做 Cocos Creator 大量条目列表时使用。虚拟列表、节点复用。
category: gamedev
tags: [cocoscreator, 性能, 列表]
---

# Cocos Creator 长列表优化

## 何时用

- 排行榜、好友列表、背包物品、聊天记录等条目数量超过 50 条时。
- ScrollView 滑动时帧率下降，Profiler 显示大量 `Layout` 或 `Sprite` 更新耗时时。
- 启动时一次性 `instantiate` 了几百个 item 节点导致进入场景卡顿时。
- 列表数据频繁刷新（如实时排行榜推送）但整体 CPU 占用居高不下时。
- 图片异步加载导致列表滚动时出现闪烁或短暂空白占位时。

## 核心规则

### 1. 虚拟列表：只实例化可视区 + 缓冲节点，滚动时复用

**规则：** 不论列表数据有多少条，同时存在于场景节点树中的 item 节点数量 = 可视区可容纳数量 + 固定缓冲量（通常 4~6 个）；滚动时将移出可视区的节点重新定位到新进入可视区的位置并更新数据，不增减节点数量。

**为什么：** 这是长列表性能的根本问题。AI 生成列表代码时的惯用写法是循环 `cc.instantiate(itemPrefab)` 并 `addChild` 全部数据——500 条排行榜就创建 500 个节点，每个节点含 Sprite、Label、Button，光是节点树渲染遍历就够卡的。实测在中端安卓机上，一次性创建 200 个含图片的列表节点耗时超过 1 秒，直接导致进入场景的白屏卡顿。更致命的是：ScrollView 的 `content` 节点拖 Layout 组件后，每次 `addChild` 都会触发整个 Layout 的重排，200 次 `addChild` = 200 次全量重排，复杂度是 O(n²)。

**怎么做：**
- 计算可视区高度 / 单个 item 高度，得到可见数量 `visibleCount`，加缓冲 `visibleCount + 6` 作为实际节点池大小。
- `onLoad` 里只创建这么多节点放入节点池，`content` 节点不挂 Layout 组件（手动控制 `y` 坐标）。
- `content` 节点高度设为 `总条目数 × itemHeight`，让 ScrollView 滚动条正确反映总量。
- 监听 ScrollView 的 `SCROLL_EV` 或在 `update` 里用节流检测滚动偏移，计算当前第一个可见索引 `firstIndex`，遍历节点池把每个节点的 `y = -(firstIndex + i) * itemHeight`，并调用 `refreshItem(node, data[firstIndex + i])` 更新数据。

---

### 2. 节点复用池：对象池管理 item 节点，避免滚动时频繁创建销毁

**规则：** item 节点用 `NodePool`（或简单数组）管理复用，不在滚动回调里 `instantiate`/`destroy`；归还节点时在 `unuse` 钩子里重置所有可视状态（图片、文字、选中态），避免残留数据。

**为什么：** 即使实现了虚拟列表，如果每次 item 滑出可视区就 `destroy`、滑入就 `instantiate`，性能依然很差。`instantiate` 一个含多个子节点的 prefab 在移动端耗时 5~20 ms，60fps 的帧预算只有 16ms，几个 item 同时进入视野就直接掉帧。更隐蔽的问题：归还节点时不重置状态，下次从池里取出的节点仍然显示上一个位置的数据（旧头像、旧分数），等异步加载完成后才刷新，用户会看到数据"闪变"。

**怎么做：**
- 定义 `ItemController` 组件，实现 `unuse()` 方法清空头像 Sprite（`this.avatar.spriteFrame = null`）、重置文字、隐藏选中态。
- 对象池声明：`private _itemPool: NodePool = new NodePool('ItemController');`。
- 取节点：`const node = this._itemPool.size() > 0 ? this._itemPool.get()! : instantiate(this.itemPrefab);`
- 还节点：`this._itemPool.put(node);`（内部自动调用 `ItemController.unuse()`）。
- `onDestroy` 里：`this._itemPool.clear();`，防止场景卸载后池内节点仍挂载于内存。

---

### 3. 数据视图分离：滚动只更新可见 item 的数据绑定，不重建节点

**规则：** 列表的「数据模型」和「节点视图」严格分离；滚动时只调用 `itemNode.getComponent(ItemController).refresh(data)` 更新绑定数据，绝不销毁重建节点，也不对不可见节点做任何数据操作。

**为什么：** 数据视图没有分离时，刷新列表（如排行榜推送新数据）会触发对所有节点的重绑定，即便用户只看到前 10 条，后面 490 条的节点也在做无效的 `label.string = ...` 和 `spriteFrame` 赋值操作。AI 生成的"刷新列表"代码通常是 `this.itemNodes.forEach((node, i) => node.getComponent(...).refresh(allData[i]))`——如果 `itemNodes` 里有 500 个节点，这就是 500 次赋值，每次赋值都可能触发 Label 的 dirty 重排和 Sprite 的纹理更新。另一个常见错误：数据更新时直接 `removeAllChildren` + 重建，整个列表闪一下，所有滚动位置归零。

**怎么做：**
- 维护 `_dataList: ItemData[]` 作为纯数据数组，不与节点一一对应。
- 维护 `_visibleItems: Map<number, Node>` 记录「数据索引 → 节点」的当前映射。
- 滚动处理函数里只对进入可视区的新索引调用 `refresh`，对移出的索引取消映射并归还节点池。
- 数据更新（排行榜推送）只更新 `_dataList`，然后对当前 `_visibleItems` 里的每个节点重新 `refresh`，不触碰不可见节点。
- `refresh(data: ItemData)` 方法内部做最小更新：只在数据真正变化时才赋值（可用简单的 `if (this._lastData?.score !== data.score)` 守卫）。

---

### 4. 避免每帧重排：Layout 批量操作，图片异步加载 + 占位

**规则：** `content` 节点在需要插入/删除 item 时，批量操作完成后再调用一次 `Layout.updateLayout()`，不每次 `addChild`/`removeChild` 都触发重排；图片资源异步加载时先显示占位图，加载完成后更新，不阻塞主线程等待。

**为什么：** Layout 组件有一个不直观的特性：默认情况下每次子节点的 `active`、`position`、`size` 变化都会标记 dirty 并在下一帧重新计算所有子节点位置。如果在一次 `update` 里有 10 个 item 同时更新，就是 10 次 dirty 标记，触发 10 次全量 Layout 计算。对于虚拟列表来说，应该完全不使用 Layout 组件，手动计算每个节点的 `y` 坐标（`-(index * itemHeight + itemHeight/2)`），一次性批量设置，完全规避 Layout 的重排开销。图片方面，排行榜头像几十张全部同时加载会在加载完成瞬间引发纹理上传集中耗时（表现为滚动某个位置时掉一帧），用占位图 + 逐帧加载队列（每帧最多处理 2~3 个加载请求）可以平摊耗时。

**怎么做：**
- 虚拟列表的 `content` 子节点手动设置 `y`，彻底移除 `Layout` 组件。
- 若必须用 Layout（非虚拟列表的简单短列表），在所有 `addChild` 完成后调用 `layoutComp.updateLayout()`，而不是依赖自动触发。
- 头像加载：`refresh()` 里先将头像 Sprite 设为占位图，然后将真实 URL 加入加载队列；队列管理器每帧用 `scheduleOnce` 处理 2~3 个，避免同帧并发大量请求。
- 列表项高度已知时，提前将 `content` 的 `ContentSize.height` 设为 `totalCount * itemHeight`，让滚动条准确反映数据量。

---

### 5. ScrollView 性能：按需关闭惯性/弹性，权衡 Mask 开销

**规则：** 对于不需要惯性滑动的列表（如固定翻页、步进选择），关闭 ScrollView 的 `inertia` 属性；评估是否需要 `Mask` 组件——Mask 会产生一次 Draw Call 中断和模板测试开销，在节点复杂的列表上影响显著；必须遮罩时优先用 `RenderTexture` 裁切方案替代复杂嵌套 Mask。

**为什么：** `inertia`（惯性）在手指抬起后继续触发 `SCROLLING` 事件，虚拟列表的重定位逻辑会在惯性滑动期间持续执行。如果惯性阶段触发了图片加载、数据请求等重操作，会明显拖慢惯性停止。Mask 的性能问题更隐蔽：每一个 Mask 组件会打断批处理（Batching），在同一帧里造成额外的渲染状态切换，哪怕 Mask 遮盖的内容只有一个图片。常见错误：给 ScrollView 外层套 Mask 实现圆角容器，再在 ScrollView 内部每个 item 再套一个 Mask 实现圆角头像，两层 Mask 叠加，Profiler 里 Draw Call 数直接翻倍。

**怎么做：**
- 翻页列表、步进选择列表：`scrollView.inertia = false;`，减少多余的 `SCROLLING` 回调。
- 需要圆角头像时，优先使用预裁切好的圆形头像纹理，而非运行时 Mask。
- 如果 ScrollView 外容器需要圆角裁切，评估是否能换成图片叠层遮罩（让一张圆角蒙版图片置于最上层），而非挂 Mask 组件。
- 用 Creator Profiler 的「Render」面板观察 Draw Call 变化，加 Mask 前后对比，超过预期则寻找替代方案。
- 大列表开启 `ScrollView` 的 `horizontalScrollBar`/`verticalScrollBar` 时，评估滚动条本身的 Draw Call 代价，不需要时隐藏滚动条节点（`node.active = false` 而非 opacity = 0）。

---

## 正例 / 反例

### 反例：一次性 instantiate 全部数据 + Layout 每次重排

```typescript
// 反例 — 500 条数据全部 instantiate，Layout 自动重排，进场白屏卡顿
import { _decorator, Component, instantiate, Node, Prefab, Layout } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('RankList')
export class RankList extends Component {
    @property(Prefab) itemPrefab: Prefab = null!;
    @property(Node) content: Node = null!;

    private _dataList: RankData[] = [];

    refreshList(dataList: RankData[]) {
        this._dataList = dataList;
        // ❌ 每次刷新先全删再全建，列表闪烁，滚动位置归零
        this.content.removeAllChildren();

        for (const data of dataList) {
            // ❌ 500 条数据 = 500 次 instantiate，耗时数秒
            const item = instantiate(this.itemPrefab);
            this.content.addChild(item);  // ❌ 每次 addChild 触发 Layout 全量重排
            item.getComponent(ItemController)!.refresh(data);
        }
        // ❌ Layout 组件挂在 content 上，已被触发了 500 次 dirty
    }
}
```

```typescript
// 正例 — 虚拟列表：固定节点数，滚动时复用 + 手动坐标，不用 Layout
import { _decorator, Component, Node, Prefab, NodePool, ScrollView,
         instantiate, UITransform } from 'cc';
const { ccclass, property } = _decorator;

const ITEM_HEIGHT   = 120;   // item 高度（设计分辨率单位）
const BUFFER_COUNT  = 6;     // 可视区外缓冲节点数

@ccclass('RankList')
export class RankList extends Component {
    @property(Prefab)       itemPrefab:  Prefab     = null!;
    @property(Node)         content:     Node       = null!;
    @property(ScrollView)   scrollView:  ScrollView = null!;

    private _dataList:    RankData[]           = [];
    private _itemPool:    NodePool             = new NodePool('ItemController');
    private _visibleMap:  Map<number, Node>    = new Map();
    private _pooledNodes: Node[]               = [];
    private _visibleCount: number              = 0;

    onLoad() {
        // ✅ 计算可视区能容纳的节点数
        const viewHeight = this.scrollView.node.getComponent(UITransform)!.contentSize.height;
        this._visibleCount = Math.ceil(viewHeight / ITEM_HEIGHT) + BUFFER_COUNT;

        // ✅ 只创建固定数量的节点，不随数据量变化
        for (let i = 0; i < this._visibleCount; i++) {
            const node = instantiate(this.itemPrefab);
            this.content.addChild(node);
            node.active = false;
            this._pooledNodes.push(node);
        }
        // ✅ content 不挂 Layout 组件，手动管理 y 坐标
    }

    refreshList(dataList: RankData[]) {
        this._dataList = dataList;

        // ✅ 更新 content 总高度让滚动条准确
        const ut = this.content.getComponent(UITransform)!;
        ut.setContentSize(ut.contentSize.width, dataList.length * ITEM_HEIGHT);

        this.updateVisibleItems();
    }

    private updateVisibleItems() {
        const scrollOffset = this.scrollView.getScrollOffset().y;
        const firstIndex   = Math.max(0, Math.floor(scrollOffset / ITEM_HEIGHT));

        let poolIdx = 0;
        for (let i = firstIndex; i < Math.min(firstIndex + this._visibleCount, this._dataList.length); i++) {
            if (this._visibleMap.has(i)) continue;    // ✅ 已显示则跳过，不重复刷新

            const node = this._pooledNodes[poolIdx++];
            if (!node) break;

            node.active = true;
            // ✅ 手动设置 y，不依赖 Layout
            node.setPosition(0, -(i * ITEM_HEIGHT + ITEM_HEIGHT / 2));
            node.getComponent(ItemController)!.refresh(this._dataList[i]);
            this._visibleMap.set(i, node);
        }
    }

    onDestroy() {
        this._itemPool.clear();   // ✅ 场景卸载时清空节点池
    }
}
```

---

### 反例：刷新时对所有节点重绑定 + 同帧并发加载全部头像

```typescript
// 反例 — 数据推送时对全部 500 个节点赋值，同帧加载所有头像
refreshAll(newData: RankData[]) {
    this._dataList = newData;
    // ❌ 无论节点是否可见，全部遍历赋值，500 次 dirty 操作
    this._allItemNodes.forEach((node, i) => {
        node.getComponent(ItemController)!.refresh(newData[i]);
        // ❌ 同帧触发 500 个头像的网络/本地加载，纹理上传集中耗时
        resources.load(`avatars/${newData[i].userId}`, SpriteFrame, (err, sf) => {
            node.getComponent(ItemController)!.setAvatar(sf);
        });
    });
}
```

```typescript
// 正例 — 只刷新可见节点 + 加载队列平摊纹理上传
refreshAll(newData: RankData[]) {
    this._dataList = newData;
    // ✅ 只更新当前可见节点
    this._visibleMap.forEach((node, dataIndex) => {
        if (dataIndex < newData.length) {
            node.getComponent(ItemController)!.refresh(newData[dataIndex]);
        }
    });
}

// ItemController 内部：头像加载用占位 + 队列
refresh(data: RankData) {
    this._nameLabel.string = data.name;
    this._scoreLabel.string = String(data.score);
    // ✅ 先显示占位图，不阻塞
    this._avatar.spriteFrame = this._placeholderFrame;
    // ✅ 将加载请求加入全局队列，由队列管理器每帧限速处理
    AvatarLoadQueue.enqueue(data.avatarUrl, (sf: SpriteFrame) => {
        if (this.isValid) this._avatar.spriteFrame = sf;   // ✅ 判断节点是否仍有效
    });
}
```

---

## 自查清单

- [ ] 列表节点数量固定为「可视区数量 + 缓冲量」，不随数据条目数增减节点。
- [ ] `content` 节点没有挂 `Layout` 组件，item 的 `y` 坐标由代码手动设置。
- [ ] item 节点通过 `NodePool` 复用，`unuse()` 钩子里清空了图片、文字、选中态等可视状态。
- [ ] 数据刷新时只对当前可见节点调用 `refresh()`，不遍历全量数据节点。
- [ ] 头像/图标等图片资源异步加载时先显示占位图，加载完成后再更新 `spriteFrame`。
- [ ] `onDestroy` 里调用了 `pool.clear()`，场景卸载后节点池不残留内存。
- [ ] 用 Creator Profiler 测量过滚动帧率，Draw Call 数量在目标机型帧预算内。
