---
name: cocos-creator-bundle
description: Cocos Creator 用 AssetBundle 做分包/远程资源时使用。加载、释放、依赖、缓存。
category: gamedev
tags: [cocoscreator, bundle, 资源]
---

# Cocos Creator 分包与 AssetBundle

## 何时用

- 项目首屏加载慢、初始包体过大，需要按场景/功能拆分资源加载时。
- 使用远程资源服务器动态下发资源，需要管理 bundle 版本与缓存时。
- 多个 bundle 之间存在共用贴图、字体、音频等公共资源，担心重复打包导致体积膨胀时。
- 切换场景后内存异常偏高，怀疑已卸载的 bundle 资源仍驻留时。

## 核心规则

### 1. 合理分包：按场景/功能/共享拆分，主包瘦身首屏快

**规则：** 把非首屏所需的场景、UI、音频拆入独立 bundle；所有 bundle 共用的基础资源（公共 UI 图集、角色骨架、音效库）单独放一个 `shared` bundle 先行加载；主包只保留启动脚本和 Loading 界面资源。

**为什么：** AI 生成项目结构时最常见的做法是"把所有资源都放 resources 目录"，结果主包体积随着项目增长无节制膨胀，冷启动时间在中低端安卓机上轻松超过 10 秒。具体误区：把战斗场景的 1024×1024 角色图集和大厅场景的 BGM 全部打进主包——用户可能只是点了一下广告入口，根本不会进战斗场景，却已经把战斗资源全下载了。`resources` 目录下的所有资源会强制进主包，这是另一个常踩的坑。

**怎么做：**
- 在编辑器 Asset 面板右键目录 → 「创建 Bundle」，配置 Bundle Name 和优先级。
- 首屏仅需的资源留在 `resources` 或主包；战斗、副本、活动等按功能各建一个 bundle。
- 公共资源建 `shared` bundle，设置优先级最高，在游戏初始化阶段最先加载。
- 用 `Build` 面板检查 「Asset Bundle」标签，确认各 bundle 包含资源列表符合预期。

---

### 2. 加载与释放：loadBundle → bundle.load，用完正确释放防泄漏

**规则：** 通过 `assetManager.loadBundle` 获取 `AssetBundle` 对象，再用 `bundle.load` 加载具体资源；资源用完后调用 `bundle.release(path, type)` 或 `bundle.releaseAll()` 释放；bundle 本身用 `assetManager.removeBundle(bundle)` 卸载，两步缺一不可。

**为什么：** 只调用 `bundle.releaseAll()` 而不调用 `assetManager.removeBundle` 是高频错误：资源引用计数归零了，但 `assetManager` 内部仍缓存着这个 bundle 的实例，下次 `loadBundle` 同名 bundle 时直接返回缓存对象而不重新下载——如果服务器上 bundle 已更新，客户端却拿到旧的缓存，就会出现内容错误但不报任何错的诡异 bug。反过来，只调用 `removeBundle` 而不先 `releaseAll`，bundle 内资源引用计数不归零，纹理内存永远不释放。

**怎么做：**
```typescript
// 加载 bundle
assetManager.loadBundle("battle", (err, bundle) => {
    if (err) { console.error(err); return; }
    // 加载具体资源
    bundle.load("prefabs/Enemy", Prefab, (err, prefab) => {
        if (err) { console.error(err); return; }
        prefab.addRef();          // 手动管理引用计数
        this._enemyPrefab = prefab;
    });
});

// 离开战斗场景时释放
leaveBattle() {
    if (this._enemyPrefab) {
        this._enemyPrefab.decRef();
        this._enemyPrefab = null;
    }
    const bundle = assetManager.getBundle("battle");
    if (bundle) {
        bundle.releaseAll();                    // 先释放 bundle 内所有资源引用计数
        assetManager.removeBundle(bundle);      // 再移除 bundle 缓存
    }
}
```

---

### 3. 依赖与共享：公共资源放共享 bundle，跨 bundle 依赖须显式管理

**规则：** 被多个 bundle 引用的资源必须放入独立的 `shared` bundle，不能让同一份资源分别打入各个 bundle；加载使用了跨 bundle 依赖的 bundle 时，必须先确保依赖 bundle 已加载完毕。

**为什么：** Creator 在打包时如果发现某个资源被多个 bundle 引用，且没有显式归属到共享 bundle，会把该资源分别复制打入每个依赖它的 bundle——1MB 的角色骨架可能被复制进 3 个 bundle，包体直接增加 2MB。更危险的是运行时：battle bundle 里的 Enemy prefab 依赖 shared bundle 里的骨架动画，如果 shared 还没加载完就去 instantiate Enemy，会得到材质丢失、动画报错的"紫块人物"，且错误日志只提示"找不到资源 UUID"，新手很难定位到是加载顺序问题。

**怎么做：**
- 在 Asset 面板中，把公共图集、公共 prefab、公共脚本所在目录单独设为 `shared` bundle。
- 应用启动时序：先 `loadBundle("shared")` → 完成后再并行加载其他 bundle。
- 跨 bundle 依赖用编辑器 Bundle 依赖配置（Creator 3.x 支持在 bundle 属性里声明依赖）。
- 打包后检查 `build/assets` 目录，同一资源 UUID 不应出现在多个 bundle 的 manifest 里。

---

### 4. 远程加载：携带 version 参数，失败须重试与降级

**规则：** 远程 bundle 的 `loadBundle` 调用必须传入 `version` 或开启 MD5 资源名，防止浏览器/系统 HTTP 缓存拿到旧版本；在失败回调中实现有限次重试（建议 3 次，指数退避），超过重试次数后向用户展示网络错误提示或降级到内置版本。

**为什么：** 不加 version 的远程 bundle 请求会被移动端系统网络层缓存：bundle 更新上线后，部分用户的设备缓存了旧的 `manifest.json`，导致新增的活动道具贴图请求 404、新 prefab 结构与旧代码不匹配引发崩溃。这类 bug 极难复现——测试人员清过缓存所以没问题，但线上大量用户遭遇。另一个高频问题：单次 `loadBundle` 失败就直接弹错误框退出游戏，用户因为一次网络波动就被踢出，差评率飙升。

**怎么做：**
```typescript
const REMOTE_BASE = "https://cdn.example.com/bundles/";
const BUNDLE_VERSION = "20240601";

function loadRemoteBundle(name: string, retries = 3): Promise<AssetManager.Bundle> {
    return new Promise((resolve, reject) => {
        assetManager.loadBundle(`${REMOTE_BASE}${name}`, { version: BUNDLE_VERSION },
            (err, bundle) => {
                if (!err) { resolve(bundle); return; }
                if (retries > 0) {
                    // 指数退避重试
                    this.scheduleOnce(() => {
                        loadRemoteBundle(name, retries - 1).then(resolve).catch(reject);
                    }, (4 - retries) * 1.5);
                } else {
                    // 超过重试次数，降级到本地内置 bundle
                    const fallback = assetManager.getBundle(name);
                    fallback ? resolve(fallback) : reject(err);
                }
            }
        );
    });
}
```

---

### 5. 释放时机：切场景时释放无用 bundle，不长期驻留爆内存

**规则：** 场景切换或关闭功能模块时，立即释放该模块专属 bundle（`releaseAll` + `removeBundle`）；`shared` 等全局 bundle 驻留内存；建立 BundleManager 单例统一追踪哪些 bundle 当前已加载，避免重复加载和忘记释放。

**为什么：** 不建立统一管理机制的项目，最终必然出现"同一个 bundle 被 3 个组件各自 loadBundle 了一次，却没有任何一个组件负责 release"的情况。Creator 的 `loadBundle` 对已加载的 bundle 会直接返回缓存，所以不会报错，内存只增不减。在一次游戏会话里玩家进出了 10 个不同副本，每个副本加载了各自的 bundle，全部常驻内存，低端机直接被系统杀进程。另一个常见失误：在 `onDestroy` 里 release，但 `onDestroy` 晚于场景卸载执行，此时资源已被场景的 `autoReleaseAssets` 部分释放，release 调用顺序混乱导致引用计数算错。

**怎么做：**
```typescript
// BundleManager 单例，统一管理 bundle 生命周期
export class BundleManager {
    private static _instance: BundleManager;
    static get instance() {
        return this._instance || (this._instance = new BundleManager());
    }

    private _loaded: Map<string, AssetManager.Bundle> = new Map();

    async load(name: string, options?: Record<string, any>): Promise<AssetManager.Bundle> {
        if (this._loaded.has(name)) return this._loaded.get(name)!;
        return new Promise((resolve, reject) => {
            assetManager.loadBundle(name, options ?? {}, (err, bundle) => {
                if (err) { reject(err); return; }
                this._loaded.set(name, bundle);
                resolve(bundle);
            });
        });
    }

    unload(name: string) {
        const bundle = this._loaded.get(name);
        if (!bundle) return;
        bundle.releaseAll();
        assetManager.removeBundle(bundle);
        this._loaded.delete(name);
    }
}
```

---

## 正例 / 反例

### 反例：resources 堆积 + 忘记 removeBundle + 无版本远程加载

```typescript
// 反例 — 所有资源放 resources，加载远程 bundle 不带版本，release 不彻底
@ccclass
export class BattleLoader extends Component {
    // ❌ 大量资源堆在 resources 导致主包膨胀
    // ❌ 没有统一的 bundle 管理，各模块各自 load

    async enterBattle() {
        // ❌ 远程 bundle 不带 version，HTTP 缓存会返回旧版本
        assetManager.loadBundle("https://cdn.example.com/battle", (err, bundle) => {
            bundle.load("Enemy", Prefab, (err, prefab) => {
                cc.instantiate(prefab); // ❌ 直接用，没有 addRef
            });
        });
    }

    leaveBattle() {
        const bundle = assetManager.getBundle("battle");
        // ❌ 只调用 releaseAll，没有 removeBundle，bundle 缓存仍在
        // ❌ prefab 没有 decRef，引用计数不归零，纹理内存永不释放
        bundle?.releaseAll();
    }
}
```

```typescript
// 正例 — BundleManager 统一管理，版本控制，双步释放
@ccclass
export class BattleLoader extends Component {
    private _enemyPrefab: Prefab | null = null;

    async enterBattle() {
        // ✅ 通过 BundleManager 加载，携带版本号，防 HTTP 缓存
        const bundle = await BundleManager.instance.load("battle", {
            version: "20240601"
        });
        bundle.load("Enemy", Prefab, (err, prefab) => {
            if (err) { console.error("加载 Enemy prefab 失败:", err); return; }
            prefab.addRef();               // ✅ 手动管理引用计数
            this._enemyPrefab = prefab;
            cc.instantiate(prefab);
        });
    }

    leaveBattle() {
        // ✅ 先释放具体资源引用计数
        if (this._enemyPrefab) {
            this._enemyPrefab.decRef();
            this._enemyPrefab = null;
        }
        // ✅ BundleManager 内部 releaseAll + removeBundle，两步都做
        BundleManager.instance.unload("battle");
    }
}
```

---

### 反例：共享资源重复打包 + 无 shared bundle 先行加载

```typescript
// 反例 — 没有 shared bundle，各 bundle 里各自包含了同一份角色骨架
// 在代码层面体现为加载顺序不保证，instantiate 时骨架丢失

async loadDungeon() {
    // ❌ dungeon bundle 依赖 character 骨架，但没有确保 shared 先加载
    assetManager.loadBundle("dungeon", (err, bundle) => {
        bundle.load("Knight", Prefab, (err, prefab) => {
            // ❌ 骨架动画资源未就绪，instantiate 后是紫色方块
            cc.instantiate(prefab);
        });
    });
}
```

```typescript
// 正例 — shared bundle 先行，再加载功能 bundle
async loadDungeon() {
    // ✅ 确保 shared bundle（含骨架、公共图集）已加载
    await BundleManager.instance.load("shared");
    // ✅ shared 就绪后再加载 dungeon，依赖资源已在内存中
    const bundle = await BundleManager.instance.load("dungeon");
    bundle.load("Knight", Prefab, (err, prefab) => {
        if (err) { console.error(err); return; }
        prefab.addRef();
        this._knightPrefab = prefab;
        cc.instantiate(prefab);
    });
}
```

---

## 自查清单

- [ ] 非首屏资源已从 `resources` 目录移出，拆入对应功能 bundle，主包体积已检查。
- [ ] 公共资源（共用图集、骨架、字体）已独立放入 `shared` bundle，不在多个 bundle 中重复打包。
- [ ] 所有 `loadBundle` 调用使用 `BundleManager` 统一管理，没有散落在各组件里的裸 `assetManager.loadBundle`。
- [ ] 远程 bundle 加载时传入了 `version` 参数或开启了 MD5 资源名，防止 HTTP 缓存拿到旧版本。
- [ ] 资源使用后调用了 `addRef`，释放时调用了 `decRef`，bundle 卸载时同时执行了 `releaseAll` + `removeBundle`。
- [ ] 场景切换时专属 bundle 已卸载，用 Creator Asset Debugger 面板确认目标资源引用计数归零。
- [ ] 远程加载有重试逻辑（建议 3 次指数退避）和降级方案，不会因单次网络波动直接报错退出。
