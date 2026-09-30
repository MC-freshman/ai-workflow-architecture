---
name: cocos-creator-hotupdate
description: 给 Cocos Creator 原生包做热更新时使用。version manifest、增量、校验、回滚。
category: gamedev
tags: [cocoscreator, 热更新, 发布]
---

# Cocos Creator 热更新

## 何时用

- 需要在不重新发版到应用商店的前提下更新游戏脚本、资源或配置时。
- 配置 CDN 服务器上的 `project.manifest` / `version.manifest`，或排查热更新失败/资源不一致问题时。
- 热更新后游戏仍加载旧资源，或搜索路径设置不当导致热更内容无法生效时。
- 热更异常导致本地热更目录数据损坏，需要实现回滚兜底方案时。

## 核心规则

### 1. manifest 配置：版本号与资源 MD5 必须与实际文件一致

**规则：** `project.manifest` 里每个资源条目的 MD5 值必须与服务器上实际文件的 MD5 对应；`version.manifest` 的版本号在每次发布热更时必须递增；两个 manifest 文件本身不得被 CDN 长期缓存（Cache-Control: no-cache 或极短 TTL）。

**为什么：** 手写或脚本生成 manifest 时最常见的错误是"构建后忘记重新生成 manifest"——资源 MD5 还是上一次构建的值，与服务器实际文件不匹配。`AssetsManager` 对比 MD5 时发现一致，认为不需要更新，结果新资源从未被下载，玩家看到的是旧内容但没有任何报错，开发者以为热更成功。另一个陷阱：CDN 把 `version.manifest` 缓存了 24 小时，服务器上版本号已经更新，客户端拿到的还是旧版本号，不触发更新流程，线上问题持续数小时才被发现。

**怎么做：**
- 构建流程集成 `jsb-link/res` 目录的 MD5 计算脚本，每次构建自动生成 manifest，禁止手写。
- Creator 官方提供了 `version-generator.js` 工具（位于引擎目录），CI/CD 流程在构建后自动调用。
- CDN 配置：`project.manifest` 和 `version.manifest` 设置 `Cache-Control: no-store` 或 `max-age=60`。
- 发布前用 `curl -I https://cdn.example.com/version.manifest` 确认响应头无长期缓存。
- 版本号使用时间戳或语义化版本，绝不复用旧版本号（热更服务器有旧版本号缓存时会跳过更新）。

---

### 2. 用 AssetsManager 走引擎热更流程，监听全部关键事件

**规则：** 必须监听 `UPDATE_PROGRESSION`（进度）、`ALREADY_UP_TO_DATE`（已最新）、`UPDATE_FINISHED`（完成）、`ERROR_DOWNLOAD`（下载失败）、`ERROR_VERIFY`（校验失败）等事件，在每个错误事件里记录日志并作出对应处理，不能只监听 `UPDATE_FINISHED` 就认为热更逻辑完整。

**为什么：** 只监听成功事件是 AI 生成热更代码时最普遍的问题：`assetManager` 的事件码有十余个，AI 通常只生成 `UPDATE_FINISHED` 的处理，其余全部忽略。结果：网络慢导致部分文件下载超时（`ERROR_DOWNLOAD`）没有触发重试，用户停在进度条 90% 永久卡死；资源下载后文件损坏（`ERROR_VERIFY`）没有删除损坏文件并重试，下次启动直接崩溃。`ERROR_FAILED_DECOMPRESS` 在 Android 低版本上尤其常见，忽略它会导致 zip 格式 bundle 无法解压，表现为进入某个功能模块时白屏。

**怎么做：**
```typescript
import { native } from "cc";

export class HotUpdateManager {
    private _am: native.AssetsManager | null = null;
    private _updating = false;

    init(manifestPath: string, storagePath: string) {
        if (!native.AssetsManager) return; // 非原生平台跳过
        this._am = new native.AssetsManager(manifestPath, storagePath);
        this._am.setVerifyCallback((filePath, asset) => {
            // ✅ 可在此自定义校验逻辑（默认 MD5 校验已够用，返回 true 表示通过）
            return true;
        });
    }

    checkUpdate(): Promise<boolean> {
        return new Promise((resolve) => {
            if (!this._am) { resolve(false); return; }
            this._am.setEventCallback((event) => {
                const code = event.getEventCode();
                const EventCode = native.AssetsManager.EventCode;
                if (code === EventCode.ALREADY_UP_TO_DATE) {
                    resolve(false); // 无需更新
                } else if (code === EventCode.NEW_VERSION_FOUND) {
                    resolve(true); // 有新版本
                } else if (code === EventCode.ERROR_DOWNLOAD_MANIFEST ||
                           code === EventCode.ERROR_PARSE_MANIFEST) {
                    console.error("manifest 获取失败:", event.getMessage());
                    resolve(false); // 降级：当做无更新处理
                }
            });
            this._am.checkUpdate();
        });
    }

    update(onProgress: (percent: number) => void): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this._am || this._updating) return;
            this._updating = true;
            const EventCode = native.AssetsManager.EventCode;
            this._am.setEventCallback((event) => {
                const code = event.getEventCode();
                switch (code) {
                    case EventCode.UPDATE_PROGRESSION:
                        onProgress(event.getPercent());
                        break;
                    case EventCode.UPDATE_FINISHED:
                        this._updating = false;
                        resolve();
                        break;
                    case EventCode.ERROR_DOWNLOAD:
                        console.error("下载失败:", event.getAssetId(), event.getMessage());
                        // ✅ 单个文件下载失败继续其他文件，全部完成后统一重试失败列表
                        break;
                    case EventCode.ERROR_VERIFY:
                        console.error("校验失败:", event.getAssetId());
                        this._am!.downloadFailedAssets(); // ✅ 重新下载校验失败的文件
                        break;
                    case EventCode.ERROR_FAILED_DECOMPRESS:
                        console.error("解压失败:", event.getMessage());
                        this._updating = false;
                        reject(new Error("decompress_failed"));
                        break;
                    case EventCode.UPDATE_FAILED:
                        this._updating = false;
                        reject(new Error(event.getMessage()));
                        break;
                }
            });
            this._am.update();
        });
    }
}
```

---

### 3. 增量更新：只下差异资源，大版本走应用商店

**规则：** 热更新只用于下发脚本逻辑更新（JS bundle）和小体量资源（配置表、少量贴图）；单次热更包不超过总资源的 30%；涉及引擎版本升级、原生插件变更、大规模重构的版本必须走应用商店完整包更新。

**为什么：** 把热更当成"不想过审就任意更新一切"的通道是应用商店政策红线（iOS App Store 明确禁止通过脚本热更改变核心功能），同时也是工程风险：当单次热更量超过 5MB 时，下载失败率随网络状况急剧上升，更难保证所有用户同步到一致状态。更大的技术风险：热更了 JS 逻辑但原生层（C++ 引擎、JSB 绑定）版本没变，新脚本调用了旧引擎没有的 API，崩溃无法热修复，只能紧急回滚版本号。

**怎么做：**
- 每次热更前 diff 变更文件列表，超过 30% 资源变更时改走应用商店。
- 在 `project.manifest` 的 `version` 字段里同时记录引擎版本：`"engineVersion": "3.8.2"`，AssetsManager 加载时客户端校验引擎版本是否匹配，不匹配则跳过热更并提示用户更新客户端。
- 配置表、多语言文本等纯数据文件优先通过热更下发；美术资源（图集、模型）走应用商店发布。
- 热更服务器按应用商店版本号分目录存放：`/updates/1.0.0/`、`/updates/1.1.0/`，客户端根据自身基础版本号选择对应热更路径。

---

### 4. 校验与回滚：下载后校验完整性，失败必须回滚到上一可用版本

**规则：** 热更完成后在本地热更目录保留上一版本的备份（或记录上一版本搜索路径快照）；热更后首次启动时做完整性自检（关键脚本和 manifest 文件存在且 MD5 正确）；自检失败立即删除当前热更目录，切换到上一可用版本路径，不让用户停留在损坏状态。

**为什么：** 不实现回滚的热更系统是一颗定时炸弹：用户在下载热更过程中断网、存储空间不足、系统强杀进程，都会留下部分写入的损坏文件。下次启动时 AssetsManager 认为热更已完成（本地有热更目录），不重新下载，直接用损坏文件启动，轻则白屏，重则 crash loop——用户无法自愈，只能卸载重装，差评和流失率直接拉高。

**怎么做：**
```typescript
export class HotUpdateBootstrap {
    private static readonly HOT_PATH = native.fileUtils.getWritablePath() + "hot/";
    private static readonly BACKUP_PATH = native.fileUtils.getWritablePath() + "hot_backup/";
    private static readonly MANIFEST_FILE = HotUpdateBootstrap.HOT_PATH + "project.manifest";

    // 热更完成后调用，备份当前热更目录
    static backupCurrentVersion() {
        if (native.fileUtils.isDirectoryExist(this.HOT_PATH)) {
            // 删除旧备份，将当前热更目录复制为备份
            native.fileUtils.removeDirectory(this.BACKUP_PATH);
            native.fileUtils.copyDirectory(this.HOT_PATH, this.BACKUP_PATH);
        }
    }

    // 启动时自检，失败则回滚
    static selfCheck(): boolean {
        if (!native.fileUtils.isFileExist(this.MANIFEST_FILE)) return true; // 无热更目录，用包内资源
        // 校验关键文件是否存在（可扩展为 MD5 校验）
        const keyFiles = ["src/game.js", "assets/main/index.js"];
        for (const f of keyFiles) {
            if (!native.fileUtils.isFileExist(this.HOT_PATH + f)) {
                console.warn("热更目录损坏，执行回滚:", f);
                this.rollback();
                return false;
            }
        }
        return true;
    }

    static rollback() {
        native.fileUtils.removeDirectory(this.HOT_PATH);
        if (native.fileUtils.isDirectoryExist(this.BACKUP_PATH)) {
            native.fileUtils.copyDirectory(this.BACKUP_PATH, this.HOT_PATH);
            console.log("已回滚到上一版本");
        } else {
            console.log("无备份可用，使用包内版本");
        }
    }
}
```

---

### 5. 搜索路径：热更后必须正确 setSearchPaths，优先热更目录

**规则：** 热更完成（`UPDATE_FINISHED`）后必须调用 `native.fileUtils.setSearchPaths`，将热更存储目录置于搜索路径列表的第一位；设置后调用 `native.AssetsManager.prepareFinish` 更新引擎内部状态，最后重启游戏（`cc.game.restart()`）让新搜索路径生效。

**为什么：** 这是热更新最容易被遗漏的最后一步，也是"热更成功但资源还是旧的"这一 bug 的根本原因。引擎加载资源时按搜索路径列表顺序查找，如果热更目录不在第一位，仍然优先加载包内旧资源，热更的新文件完全不生效。另一个常见错误：只在热更完成时设置搜索路径，但游戏下次冷启动时没有在初始化阶段恢复这个搜索路径，导致第一次冷启动后热更内容消失。搜索路径必须在每次应用启动时从本地存储读取并重新设置。

**怎么做：**
```typescript
export class SearchPathManager {
    private static readonly STORAGE_KEY = "hot_search_paths";

    // 每次应用启动时调用，恢复上次设置的搜索路径
    static restoreSearchPaths() {
        if (!native.fileUtils) return;
        const saved = sys.localStorage.getItem(this.STORAGE_KEY);
        if (saved) {
            const paths: string[] = JSON.parse(saved);
            native.fileUtils.setSearchPaths(paths);
            console.log("恢复热更搜索路径:", paths);
        }
    }

    // 热更完成后调用
    static applyHotUpdatePaths(hotStoragePath: string, am: native.AssetsManager) {
        // ✅ 获取热更管理器建议的搜索路径（包含热更目录和包内目录）
        const newPaths = am.getLocalManifest().getSearchPaths();
        // ✅ 持久化搜索路径，下次冷启动时恢复
        sys.localStorage.setItem(this.STORAGE_KEY, JSON.stringify(newPaths));
        native.fileUtils.setSearchPaths(newPaths);
        // ✅ 通知引擎热更完成，准备重启
        native.AssetsManager.prepareFinish();
        // ✅ 重启游戏使新路径生效
        cc.game.restart();
    }
}

// 在 main.ts 或首个场景的 onLoad 最顶部调用
SearchPathManager.restoreSearchPaths();
```

---

## 正例 / 反例

### 反例：只监听成功事件 + 热更完成不重启 + 不持久化搜索路径

```typescript
// 反例 — 只监听 UPDATE_FINISHED，忘设搜索路径，不重启
@ccclass
export class BadHotUpdate extends Component {
    start() {
        const am = new native.AssetsManager(
            "project.manifest",
            native.fileUtils.getWritablePath()
        );
        am.setEventCallback((event) => {
            // ❌ 只处理成功，ERROR_DOWNLOAD / ERROR_VERIFY 全部忽略
            if (event.getEventCode() === native.AssetsManager.EventCode.UPDATE_FINISHED) {
                console.log("热更完成");
                // ❌ 没有 setSearchPaths，热更文件根本不会被加载
                // ❌ 没有 game.restart()，内存里还是旧资源
            }
        });
        am.update();
    }
}
```

```typescript
// 正例 — 完整事件处理 + 搜索路径持久化 + 重启生效
@ccclass
export class GoodHotUpdate extends Component {
    private _hum = new HotUpdateManager();

    async start() {
        if (!native.AssetsManager) return; // ✅ 非原生平台直接跳过

        // ✅ 启动时先恢复上次的搜索路径
        SearchPathManager.restoreSearchPaths();

        const storagePath = native.fileUtils.getWritablePath() + "hot/";
        this._hum.init("project.manifest", storagePath);

        const hasUpdate = await this._hum.checkUpdate();
        if (!hasUpdate) { this.startGame(); return; }

        // ✅ 展示进度 UI
        const hasError = await this._hum.update((p) => {
            this._progressBar.progress = p;
        }).then(() => false).catch((err) => {
            console.error("热更失败:", err);
            return true;
        });

        if (hasError) {
            // ✅ 热更失败走回滚，不让用户卡死
            HotUpdateBootstrap.rollback();
            this.startGame(); // 用回滚版本继续
        } else {
            // ✅ 热更成功：持久化搜索路径 + 重启
            const am = (this._hum as any)._am as native.AssetsManager;
            SearchPathManager.applyHotUpdatePaths(storagePath, am);
            // applyHotUpdatePaths 内部会调用 game.restart()
        }
    }

    private startGame() {
        director.loadScene("Hall");
    }
}
```

---

### 反例：版本号不递增 + manifest 手写不重新生成

```typescript
// 反例 — manifest 版本号写死，不自动生成，导致热更不触发
// project.manifest (错误示例，版本号从未变过)
// {
//   "version": "1.0",           ❌ 每次热更都是 1.0，客户端认为无需更新
//   "assets": {
//     "src/game.js": { "md5": "abc123" }  ❌ 手写 md5，与实际文件不符
//   }
// }
```

```bash
# 正例 — CI/CD 构建脚本自动生成 manifest，版本号用构建时间戳
# （在 Jenkins/GitHub Actions 的构建步骤中）
node version-generator.js \
  --src ./build/jsb-link/res \
  --dest ./cdn/updates/ \
  --url https://cdn.example.com/updates/ \
  --version $(date +%Y%m%d%H%M)
# ✅ 每次构建自动扫描文件 MD5，版本号用时间戳保证递增
# ✅ 生成的 project.manifest 和 version.manifest 立即上传 CDN
```

---

## 自查清单

- [ ] `project.manifest` 由构建脚本自动生成，版本号每次递增，没有手写 MD5。
- [ ] CDN 上的 `version.manifest` 和 `project.manifest` 设置了极短 Cache-Control（≤60s 或 no-store）。
- [ ] AssetsManager 监听了 `ERROR_DOWNLOAD`、`ERROR_VERIFY`、`ERROR_FAILED_DECOMPRESS`、`UPDATE_FAILED` 全部错误事件，每个都有对应处理逻辑。
- [ ] 热更完成后调用了 `setSearchPaths`，并将路径持久化到 `localStorage`，每次冷启动时恢复。
- [ ] 热更完成后调用了 `native.AssetsManager.prepareFinish()` 和 `cc.game.restart()`，新资源才真正生效。
- [ ] 实现了回滚机制：热更完成后备份，启动时自检，损坏时自动切换到上一可用版本。
- [ ] 引擎版本升级、原生插件变更走应用商店完整包，不通过热更下发。
