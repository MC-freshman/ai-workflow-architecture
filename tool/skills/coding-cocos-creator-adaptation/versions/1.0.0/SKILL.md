---
name: cocos-creator-adaptation
description: 做 Cocos Creator 多机型/多分辨率适配时使用。Canvas、Widget、安全区。
category: gamedev
tags: [cocoscreator, 适配, ui]
---

# Cocos Creator 多分辨率适配

## 何时用

- 项目要同时支持手机横屏/竖屏或平板，发现不同机型界面错位、拉伸时。
- 设置 Canvas 的 `setDesignResolutionSize` 却不清楚 `fitWidth`/`fitHeight` 该选哪个时。
- 刘海屏/挖孔屏上关键 UI（血条、返回按钮）被系统状态栏遮住时。
- 背景图在宽屏机上两侧露黑边，或在窄屏机上被压缩变形时。
- 只在编辑器里预览没问题，发到真机后布局乱掉时。

## 核心规则

### 1. 设计分辨率与 fit 策略：按横竖屏选 fitWidth/fitHeight

**规则：** 竖屏游戏设计分辨率用「宽固定」策略（`ResolutionPolicy.FIXED_WIDTH`，等价于 fitWidth），横屏游戏用「高固定」策略（`FIXED_HEIGHT`，等价于 fitHeight）；在 `onLoad` 最早处或启动场景的 `App.ts` 里统一调用，不在各业务组件里重复设置。

**为什么：** 这是最高频犯错的地方。新手默认保持编辑器的 `SHOW_ALL`（黑边适配），在宽屏手机上两侧各出现一条黑边，玩家体验极差。AI 生成代码时经常写死 `cc.view.setDesignResolutionSize(750, 1334, cc.ResolutionPolicy.SHOW_ALL)`——这在 iPhone 8 比例下"看起来对"，换到 18:9 或 20:9 的安卓机立刻穿帮。竖屏游戏应该固定宽度让高度自然延伸（上下内容按 Widget 锚定），这样无论多长的屏幕内容都能自适应撑满，不露黑边；横屏游戏则反过来固定高度。

**怎么做：**
- 竖屏：`cc.view.setDesignResolutionSize(750, 1334, cc.ResolutionPolicy.FIXED_WIDTH);`
- 横屏：`cc.view.setDesignResolutionSize(1334, 750, cc.ResolutionPolicy.FIXED_HEIGHT);`
- 在最顶层启动脚本的 `onLoad` 里设置一次，场景切换后 `cc.view` 配置保持，不需要每个场景重设。
- 设计分辨率的宽高比不必与主流机型完全匹配，只需保证主要内容区在所有机型上不被截断即可。

---

### 2. Widget 对齐：UI 全部用 Widget 锚定，禁止写死绝对坐标

**规则：** 所有 UI 节点（按钮、血条、对话框、提示文字）必须挂 `Widget` 组件并锚定到合适的边或居中；绝对坐标（`position.x = 375`）只允许出现在以父节点为参考系且父节点本身已正确适配的情况下。

**为什么：** 在 1080×2340 手机上绝对坐标看起来对，到 720×1600 上就整体偏移。AI 生成 UI 代码时习惯输出 `this.node.setPosition(0, -500)`——这在设计分辨率内是居中底部，但换机型后高度变了，`-500` 就不再是"底部附近"。更隐蔽的问题：场景切换或节点被动态 `addChild` 到另一个父节点后，绝对坐标失效但运行时无报错，只是 UI 错位。Widget 的「UpdateAlignment」会在节点激活时自动重算位置，是唯一正确的跨分辨率对齐方式。

**怎么做：**
- 顶部 UI：Widget 勾选 Top，设 Top = 0（加安全区偏移见规则 3）。
- 底部 UI：Widget 勾选 Bottom，设 Bottom = 0。
- 居中内容：Widget 勾选 HCenter + VCenter，偏移量为 0。
- 全屏背景/容器：Widget 同时勾选 Left/Right/Top/Bottom，全部为 0，实现全屏拉伸（背景图专用）。
- 代码动态创建的 UI 节点同样需要 `node.addComponent(Widget)` 并设置对应属性，不要只用 `setPosition`。

---

### 3. 安全区：刘海屏/挖孔屏用 SafeArea，关键 UI 不被遮挡

**规则：** 在根 Canvas 下创建一个「安全区容器」节点，挂载 `SafeArea` 组件（Cocos Creator 3.x 内置），所有可能被刘海/挖孔/Home 条遮挡的 UI 放入该容器；背景图等装饰性节点放在容器外，允许延伸到边缘。

**为什么：** iPhone 14 Pro 的动态岛、安卓各厂商形态各异的挖孔摄像头、底部 Home Indicator——如果不处理安全区，玩家的返回按钮、血量数值、关键提示文字会直接被系统 UI 盖住，甚至无法点击。最常见的错误做法是手动给顶部 UI 加固定偏移 `top = 88`（iPhone X 刘海高度），这在其他机型上会多出一段空白，在新机型上又不够。`SafeArea` 组件会在运行时读取系统安全区域数据动态调整，是唯一跨机型正确的方案。

**怎么做：**
- 在 Canvas 下创建 `Node` 命名为 `SafeArea`，大小设为 `(100%, 100%)`，挂 `Widget`（全四边对齐）和 `cc.SafeArea` 组件。
- 将所有需要避开系统遮挡的 UI（顶部分数、底部操作栏、弹窗）放入 `SafeArea` 节点。
- 背景、全屏特效等不怕被遮挡的视觉元素保留在 `SafeArea` 容器外，让其撑满到屏幕物理边缘。
- 在真机（或启用安全区模拟的模拟器）上验证，编辑器默认不模拟安全区缺口。

---

### 4. 比例自适应：背景用 fill/裁切，内容区按比例缩放

**规则：** 全屏背景图用 `Sprite` 的 `SizeMode` 设为 `CUSTOM` 并配合 Widget 全拉伸，`Trim` 关闭，让图片裁切填满屏幕（类似 CSS `background-size: cover`）；核心游戏内容区（如战斗 HUD、地图区域）用统一的「安全内容节点」加等比缩放，避免拉伸变形。

**为什么：** 最常见的丑陋问题：背景图在 18:9 手机上宽高比正常，到平板的 4:3 上图片被拉宽变胖，角色脸型都变了。反过来，内容区如果也用全拉伸，按钮会被拉成椭圆。背景和内容的适配策略必须分开：背景允许裁切（多出的部分看不见无所谓），内容必须保持宽高比只能等比缩放（宁可两侧有一点间距，也不能变形）。

**怎么做：**
- 背景 Sprite：Widget 全四边对齐（Left/Right/Top/Bottom = 0），`Sprite.SizeMode = CUSTOM`，`ContentSize` 跟随父节点，让图片裁切填满。
- 内容区容器：用 `Widget` 锁定宽或高（如竖屏锁宽），另一维度自动跟随，内部子节点用 `Widget` 相对于此容器定位。
- 弹窗/对话框：固定宽高比的面板设计分辨率内写死尺寸，用 Widget 居中，不拉伸，仅随分辨率中心对齐。
- 如需等比缩放整个 HUD 层，可对 HUD 根节点按 `Math.min(scaleX, scaleY)` 做等比缩放，保证不变形。

---

### 5. 多机验证：编辑器 + 真机/模拟器测，别只信 GameView

**规则：** 每次调整适配逻辑后，必须在至少三种宽高比下验证：16:9（主流）、18:9/20:9（长屏安卓）、4:3（平板/iPad）；发布前在真机上走一遍关键 UI 的可见性和可点击性检查。

**为什么：** Creator 编辑器的 GameView 预览窗口默认固定分辨率，调宽高看起来没问题，但实际运行时引擎在真机上的适配行为与预览有细微差异（尤其是安全区、原生输入框位置）。AI 生成的适配代码只会被作者在某一固定宽高比下测试，问题在另一个宽高比下才暴露。平板的 4:3 宽高比是最容易暴露「固定坐标 UI 超出屏幕范围」的机型。

**怎么做：**
- 在 Creator 编辑器 GameView 右上角切换预设分辨率，至少测 `750×1334`（16:9）、`750×1624`（19.5:9）、`1024×768`（4:3）。
- 接入测试设备时开启 Chrome/Safari 远程调试查看 UI 真实布局。
- 对于安全区验证，在 iOS 模拟器选择有刘海的机型（iPhone 14 Pro），在安卓侧用开发者选项里的「模拟刘海屏」。
- 建立一个适配测试场景，每个关键 UI 状态（主界面、战斗、弹窗、横竖屏切换）都有固定截图 baseline，上线前对比。

---

## 正例 / 反例

### 反例：写死分辨率策略 + 绝对坐标 + 忽略安全区

```typescript
// 反例 — SHOW_ALL 策略 + 绝对坐标 + 无安全区处理
import { _decorator, Component, view, ResolutionPolicy, Node } from 'cc';
const { ccclass } = _decorator;

@ccclass('GameInit')
export class GameInit extends Component {
    onLoad() {
        // ❌ SHOW_ALL 在长屏安卓上两侧出现黑边
        view.setDesignResolutionSize(750, 1334, ResolutionPolicy.SHOW_ALL);
    }
}

// UI 布局代码——另一个组件
@ccclass('MainHUD')
export class MainHUD extends Component {
    @property(Node) backBtn: Node = null!;
    @property(Node) scoreLabel: Node = null!;

    onLoad() {
        // ❌ 写死绝对坐标，换机型/分辨率立刻错位
        this.backBtn.setPosition(-340, 580);
        this.scoreLabel.setPosition(0, 560);
        // ❌ 没有处理安全区，刘海屏上返回按钮被遮挡无法点击
    }
}
```

```typescript
// 正例 — 竖屏用 FIXED_WIDTH + Widget 锚定 + SafeArea 容器
import { _decorator, Component, view, ResolutionPolicy } from 'cc';
const { ccclass } = _decorator;

@ccclass('GameInit')
export class GameInit extends Component {
    onLoad() {
        // ✅ 竖屏固定宽度，高度自适应，不露黑边
        view.setDesignResolutionSize(750, 1334, ResolutionPolicy.FIXED_WIDTH);
    }
}
```

```
// 正例——编辑器内 SafeArea 容器 + Widget 配置（伪代码描述节点结构）
Canvas
  └─ SafeAreaContainer          ← 挂 SafeArea 组件 + Widget(L/R/T/B=0)
       ├─ TopBar                ← Widget: Top=0, Left=0, Right=0, Height=固定
       │    ├─ BackBtn          ← Widget: Top=20, Left=20  （相对 TopBar）
       │    └─ ScoreLabel       ← Widget: HCenter=0, VCenter=0
       └─ BottomBar             ← Widget: Bottom=0, Left=0, Right=0, Height=固定
  └─ Background                 ← Widget(L/R/T/B=0) + Sprite CUSTOM size（允许裁切）
```

---

### 反例：背景图拉伸变形 + 不验证长屏机型

```typescript
// 反例 — 背景图不做适配，内容等比问题未处理
@ccclass('BgController')
export class BgController extends Component {
    @property(Sprite) bgSprite: Sprite = null!;

    onLoad() {
        // ❌ SizeMode 保持 TRIMMED，背景在平板上宽高比失真变胖
        // ❌ 没有 Widget，在长屏手机上背景不够高，露出底部空白
    }
}
```

```typescript
// 正例 — 背景图裁切填满 + Widget 全拉伸
import { _decorator, Component, Sprite, Widget, UITransform } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('BgController')
export class BgController extends Component {
    @property(Sprite) bgSprite: Sprite = null!;

    onLoad() {
        // ✅ Widget 全四边对齐，背景随屏幕尺寸撑满
        const widget = this.bgSprite.node.getComponent(Widget)!;
        widget.isAlignLeft   = true;  widget.left   = 0;
        widget.isAlignRight  = true;  widget.right  = 0;
        widget.isAlignTop    = true;  widget.top    = 0;
        widget.isAlignBottom = true;  widget.bottom = 0;

        // ✅ SizeMode CUSTOM，UITransform 跟随父节点，图片裁切填满不变形
        this.bgSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        // 编辑器里勾掉 Trim，让图片裁切而非拉伸
    }
}
```

---

## 自查清单

- [ ] `setDesignResolutionSize` 的第三个参数：竖屏用 `FIXED_WIDTH`，横屏用 `FIXED_HEIGHT`，没有使用 `SHOW_ALL`。
- [ ] 所有 UI 节点（按钮、血条、标签、弹窗）都挂了 `Widget` 组件，没有通过 `setPosition` 写死绝对坐标。
- [ ] 可能被刘海/挖孔/Home 条遮挡的 UI 放入了挂载 `SafeArea` 组件的容器内。
- [ ] 背景图和装饰性全屏图使用了 Widget 全拉伸 + Sprite `CUSTOM` 尺寸，不依赖原始图片宽高比。
- [ ] 核心内容区（非背景）使用等比缩放或固定尺寸居中，没有随屏幕尺寸拉伸变形。
- [ ] 在编辑器 GameView 中切换过 16:9、18:9/20:9、4:3 三种宽高比预览，都没有 UI 错位或露底。
- [ ] 在有刘海的真机或模拟器上验证过安全区，关键按钮在刘海区域以下且可正常点击。
