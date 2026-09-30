---
name: cocos-creator
description: 写 Cocos Creator（TypeScript）时使用。组件、节点、prefab、事件、资源管理规范。
category: gamedev
tags: [cocoscreator, typescript, 组件]
---

# Cocos Creator 最佳实践

## 何时用

- 编写任何 Cocos Creator TypeScript 组件脚本前。
- 发现内存持续上涨、资源释放后再加载仍占用内存时。
- 节点引用丢失、组件生命周期回调顺序不符合预期时。
- EventTarget 事件监听器未被正确注销，导致重复触发或内存泄漏时。
- prefab 频繁 instantiate/destroy 造成帧率抖动时。

## 核心规则

### 1. 组件化：@property 暴露，生命周期时序清楚

**规则：** 逻辑封装在继承自 `Component` 的脚本里，Inspector 可调属性用 `@property` 装饰器声明；`onLoad` 做自身初始化，`start` 做跨组件依赖初始化，`onEnable`/`onDisable` 管理激活态资源，`onDestroy` 清理一切外部引用。

**为什么：** AI 生成 Creator 组件时最常见的错误是在 `onLoad` 里调用另一个组件的方法——但另一个组件的 `onLoad` 还没执行，得到 undefined 或抛出"Cannot read property of undefined"。新手则把所有逻辑都堆进 `start`，`onEnable`/`onDisable` 完全不用，导致节点被反复激活时调度器和事件重复注册，表现为每激活一次组件，事件就多响应一次。正确的分层：`onLoad` = 自身组件引用缓存；`start` = 订阅事件、跨节点通信；`onEnable` = 恢复运行状态；`onDisable` = 暂停运行状态；`onDestroy` = 注销事件、释放资源。

**怎么做：**
- `@property(cc.Node) targetNode: cc.Node = null!;` — Inspector 拖拽赋值，不在代码里 find。
- `onLoad` 里只缓存 `this.getComponent`、`this.node.getChildByName` 等本节点树内的引用。
- 跨节点通信（如 GameManager）的引用在 `start` 里获取，保证对方 `onLoad` 已完成。
- `onDestroy` 里注销所有 EventTarget 监听器，停止所有 tween，清空定时器。

---

### 2. 节点引用：缓存引用，prefab 高频对象用对象池

**规则：** 节点或组件引用在 `onLoad` 里缓存成私有字段，绝不在 `update` 或高频函数里调用 `find`、`getChildByName`、`getComponent`；频繁实例化销毁的对象（子弹、特效、列表项）用 `NodePool` 管理，不用 `instantiate` + `destroy`。

**为什么：** `node.getChildByName("xxx")` 是线性遍历子节点树，在 `update` 里每帧调用、节点树稍大时就能感受到 CPU 消耗。AI 写原型代码时习惯"需要用谁就 find 谁"，在单个脚本里看起来没问题，但一旦场景有几十个同类组件并发运行，性能立刻崩塌。对象池的价值：移动端 `instantiate` 一个复杂 prefab 耗时可达数十毫秒（涉及资源解析、组件初始化），批量生成敌人或特效时直接造成卡顿帧；`NodePool` 复用已有节点，激活耗时降一个数量级。新手不用对象池的另一个原因是不知道如何处理"归还时重置状态"——容易留下上次使用的残留数据。

**怎么做：**
- `onLoad` 里：`this._hpBar = this.node.getChildByName("HPBar").getComponent(cc.ProgressBar);`。
- 对象池声明：`private _bulletPool: cc.NodePool = new cc.NodePool("BulletController");`（参数为组件名，归还时调用该组件的 `unuse` 钩子重置状态）。
- 借出：`const node = this._bulletPool.size() > 0 ? this._bulletPool.get() : cc.instantiate(this.bulletPrefab);`。
- 归还：`this._bulletPool.put(node);`，在 BulletController 的 `unuse()` 里重置速度、血量、特效状态。
- `onDestroy` 里：`this._bulletPool.clear();` 释放池内所有节点。

---

### 3. 事件解耦：EventTarget 通信，监听必须 off

**规则：** 组件间通信优先用 `EventTarget`（全局事件中心或节点事件），不硬引用对方组件直接调方法；`on` 注册的所有监听器在 `onDestroy` 里用 `off` 注销，或使用 `targetOff(target)` 批量注销。

**为什么：** 组件硬引用是 Creator 项目里耦合度膨胀的最大来源：`this.gameManager.addScore(10)` 直接调用，GameManager 重构时所有引用方都要改。AI 倾向于生成这种"直接、简单"的代码，在小 demo 里无害，但项目稍大就变成一张网，谁都不敢动。事件系统的另一个高频 bug：`onLoad` 里注册了监听器，`onDestroy` 里没有 `off`，节点销毁后如果事件仍然触发，回调里访问 `this` 的字段——`this` 已销毁，轻则 undefined，重则引擎报 "js exception: Cannot set property of null"，且报错栈指向事件调度处而不是注册处，极难追踪。

**怎么做：**
- 全局事件：定义单例 `GameEvent` 类继承 `EventTarget`，模块间通过它通信。
- 注册：`GameEvent.instance.on("score_changed", this.onScoreChanged, this);`（第三个参数 this 是 target，用于批量注销）。
- 注销：`onDestroy() { GameEvent.instance.targetOff(this); }` — 一句话注销该组件注册的所有监听器。
- 节点事件（UI 按钮等）用 `node.on(cc.Node.EventType.TOUCH_END, handler, this)`，同样在 `onDestroy` 里 `node.targetOff(this)`。
- 避免匿名函数注册（无法单独 off）；若必须用匿名函数，保存引用：`this._handler = () => ...; event.on("x", this._handler, this);`。

---

### 4. 资源管理：assetManager 正确加载与释放，引用计数不可忽视

**规则：** 动态资源通过 `resources.load` 或 `assetManager.loadBundle` 加载，用完后调用 `asset.decRef()` 或 `assetManager.releaseAsset(asset)` 释放；图集（SpriteAtlas）释放时要同步释放包含的 SpriteFrame，否则图集卸载但纹理内存仍驻留；场景切换时通过 `autoReleaseAssets` 或手动 release 确保资源回收。

**为什么：** Creator 的资源系统是引用计数制，每次 `load` 引用计数 +1，只有计数归零才真正释放 GPU 纹理内存。AI 生成的代码几乎从不调用 release——"加载了用就完了"。结果：进入战斗场景加载了角色图集，退出后图集和所有 SpriteFrame 的引用计数仍是 1（load 时的那次），内存永不回收，多次进出战斗后内存涨到被系统杀掉。新手常见的另一个错误：`assetManager.releaseAsset(atlas)` 只释放了图集本身，但图集包含的每一个 SpriteFrame 有自己的引用计数，需要 `atlas.getSpriteFrames().forEach(sf => sf.decRef())` 才能让纹理真正卸载。

**怎么做：**
- 加载：`resources.load("ui/atlas", cc.SpriteAtlas, (err, atlas) => { atlas.addRef(); this._atlas = atlas; });`（手动 addRef 管理生命周期）。
- 释放：`onDestroy() { if (this._atlas) { this._atlas.decRef(); this._atlas = null; } }`。
- 图集批量释放封装：
  ```typescript
  releaseAtlas(atlas: cc.SpriteAtlas) {
      atlas.getSpriteFrames().forEach(sf => sf.decRef());
      atlas.decRef();
  }
  ```
- 场景切换：在 `cc.director.loadScene` 前调用当前场景加载的资源的 release，或在 Scene 属性里勾选 `autoReleaseAssets`（适合一次性场景）。
- 用 Creator 的 Asset Debugger 面板确认目标资产引用计数在场景退出后归零。

---

### 5. update 性能：每帧逻辑极简，善用调度器与缓动

**规则：** `update` 里只放真正需要每帧平滑插值的逻辑（移动、跟随）；状态轮询改为事件驱动；字符串拼接、对象创建、数组遍历从 `update` 移出；UI 动画用 `cc.tween`，不用 `update` 手写插值。

**为什么：** Creator 运行在单线程 JS 环境，`update` 是每帧同步执行的主线程代码，任何耗时操作都会直接掉帧。AI 写 UI 逻辑时惯用 `update` 轮询检查条件：`if (this.node.position.x > 100) { this.doSomething(); }`——这在逻辑简单时看起来无害，但同类组件多了就是几十次 `position` 读取和比较；更糟糕的是 `update` 里 `this.label.string = "HP: " + this._hp`，每帧生成一个新字符串，GC 压力在移动端会造成明显的帧率抖动。新手不了解 `cc.tween` 时会在 `update` 里手写 `lerp`，不仅代码冗长，还难以取消/链式组合。

**怎么做：**
- 状态变化通过事件通知，UI 在收到事件时一次性更新，不在 `update` 轮询。
- 数值 UI 更新：用 `setter` 触发单次 `label.string = ...`，不在 `update` 每帧赋值。
- UI 动画：`cc.tween(node).to(0.3, { position: targetPos }).call(() => onComplete()).start();` 比 update 插值少几十行代码且可随时 `cc.Tween.stopAllByTarget(node)` 取消。
- 若 `update` 不可避免，把高频计算提到 `onLoad` 缓存（如固定的方向向量、边界值），不每帧重算。
- 用 Chrome DevTools + Creator Profiler 分析 `update` 调用耗时，对照帧预算（16.6ms @ 60fps）确保 `update` 总耗时在预算 30% 以内。

---

## 正例 / 反例

### 反例：onLoad 跨组件调用 + update 里 find 和字符串拼接

```typescript
// 反例 — onLoad 访问未初始化的跨组件，update 里 find + 字符串拼接
@ccclass
export class PlayerHUD extends Component {
    private _player: Player = null!;

    onLoad() {
        // ❌ Player 的 onLoad 可能还没执行，getComponent 可能返回 null
        this._player = cc.find("Player").getComponent(Player);
        this._player.init();  // ❌ 可能 TypeError: Cannot read property 'init' of null
    }

    update(dt: number) {
        // ❌ 每帧 find + getComponent，性能杀手
        const label = this.node.getChildByName("HpLabel").getComponent(Label);
        // ❌ 每帧字符串拼接，GC Alloc
        label.string = "HP: " + cc.find("Player").getComponent(Player).hp;
    }
}
```

```typescript
// 正例 — onLoad 缓存本地引用，start 获取跨组件引用，事件驱动更新
@ccclass
export class PlayerHUD extends Component {
    @property(Label) hpLabel: Label = null!;   // ✅ Inspector 直接拖拽，不在代码里 find

    private _player: Player = null!;

    onLoad() {
        // ✅ onLoad 只缓存自身树内组件，不跨组件
    }

    start() {
        // ✅ start 里跨组件引用已安全
        this._player = cc.find("Player").getComponent(Player)!;
        // ✅ 事件驱动更新，不在 update 轮询
        GameEvent.instance.on("hp_changed", this.onHpChanged, this);
    }

    private onHpChanged(newHp: number) {
        this.hpLabel.string = `HP: ${newHp}`;  // ✅ 只在变化时执行一次
    }

    onDestroy() {
        GameEvent.instance.targetOff(this);    // ✅ 批量注销所有监听器
    }
}
```

---

### 反例：prefab 每次 instantiate/destroy + 图集不释放

```typescript
// 反例 — 高频 instantiate/destroy，图集加载不释放
spawnBullet() {
    const bullet = cc.instantiate(this.bulletPrefab);  // ❌ 每次生成都解析 prefab，耗时
    this.node.addChild(bullet);
    this.scheduleOnce(() => {
        bullet.destroy();                              // ❌ 触发 GC，高频调用帧率抖动
    }, 3);
}

loadAtlas() {
    resources.load("ui/battle_atlas", cc.SpriteAtlas, (err, atlas) => {
        this._atlas = atlas;
        // ❌ 没有 addRef，引用计数不受控；退出时也不 release
    });
}
```

```typescript
// 正例 — NodePool 复用，资源引用计数管理
private _bulletPool: cc.NodePool = new cc.NodePool("BulletController");
private _atlas: cc.SpriteAtlas = null!;

spawnBullet() {
    // ✅ 优先从池里取，取不到才 instantiate
    const node = this._bulletPool.size() > 0
        ? this._bulletPool.get()!
        : cc.instantiate(this.bulletPrefab);
    this.node.addChild(node);
    node.getComponent(BulletController)!.launch(this._bulletPool); // 飞行结束后自行归还
}

loadAtlas() {
    resources.load("ui/battle_atlas", cc.SpriteAtlas, (err, atlas) => {
        atlas.addRef();                                // ✅ 手动管理引用计数
        this._atlas = atlas;
    });
}

onDestroy() {
    this._bulletPool.clear();                          // ✅ 释放池内节点
    if (this._atlas) {
        // ✅ 释放图集及所有 SpriteFrame
        this._atlas.getSpriteFrames().forEach(sf => sf.decRef());
        this._atlas.decRef();
        this._atlas = null!;
    }
    GameEvent.instance.targetOff(this);
}
```

---

## 自查清单

- [ ] `onLoad` 里只缓存自身节点树内的组件引用，跨节点引用全部移到 `start`。
- [ ] `update` 里没有 `find`、`getChildByName`、`getComponent` 调用，全部已在 `onLoad` 缓存。
- [ ] 高频实例化对象（子弹、特效、列表项）使用 `NodePool`，`onDestroy` 里 `pool.clear()`。
- [ ] 所有 EventTarget 监听器在 `onDestroy` 里用 `targetOff(this)` 批量注销。
- [ ] 动态加载的资源调用了 `addRef`，`onDestroy` 里有对应的 `decRef` 和置 null。
- [ ] 图集释放时逐一 `decRef` 了包含的 SpriteFrame，不仅仅释放图集本身。
- [ ] UI 动画改用 `cc.tween`，`update` 里无手写插值和每帧字符串拼接。
