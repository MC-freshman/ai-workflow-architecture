---
name: cocos2dx-lua
description: 写 Cocos2d-x Lua 时使用。节点、触摸、动作、调度器、ccui、内存的实战规范。
category: gamedev
tags: [cocos2dx, lua, 移动]
---

# Cocos2d-x Lua 最佳实践

## 何时用

- 编写任何 Cocos2d-x Lua 场景、Layer、UI 组件脚本前。
- 发现内存持续增长、退出场景后内存未释放时。
- 触摸事件穿透、多层点击响应混乱，或事件监听器未被清理时。
- 动作（Action）执行异常、Scene 切换后动画仍在报错时。
- 调度器回调在节点销毁后仍被调用，导致访问空节点崩溃时。

## 核心规则

### 1. 节点生命周期：addChild/removeChild 必须配对，退出前清理一切

**规则：** 每个 `addChild` 都要有对应的清理路径（`removeChild` 或场景切换自动销毁）；`onEnter`/`onExit` 是注册/注销外部资源（调度器、事件）的标准时机，不要在构造函数或任意时机注册后忘记注销。

**为什么：** Cocos2d-x 的 C++ 底层使用引用计数（retain/release），Lua 侧持有的 userdata 会阻止对象释放。AI 生成代码时最常犯的错误：在一个 Layer 里 `addChild` 了子节点，场景切换时只 `removeFromParent` 了 Layer，但子节点上挂的调度器回调和事件监听器没有清理，C++ 对象引用计数不归零，内存持续增长。新手则常在 `init` 里注册调度器，在 `onExit` 里忘记反注册，下次进场景又注册一次，定时器越堆越多。

**怎么做：**
- 在 `onEnter` 里注册调度器和事件监听器，在 `onExit` 里注销。
- 场景/Layer 退出时调用 `node:unscheduleAllCallbacks()` 和 `eventDispatcher:removeEventListenersForTarget(node)`。
- 临时创建的节点用完即 `removeFromParent(true)`（true = cleanup，会停止其上的 Action 和调度器）。
- 养成习惯：每加一个子节点，立刻想好"它什么时候被移除"。

---

### 2. 触摸事件：EventListener 正确注册与移除，处理吞噬与层级冲突

**规则：** 触摸事件必须用 `cc.EventListenerTouchOneByOne` 或 `cc.EventListenerTouchAllAtOnce` 注册到 `eventDispatcher`，不用旧的 `setTouchEnabled`；`setSwallowTouches(true)` 只在确实需要阻止穿透时设置，并理解其对下层 Listener 的影响；节点移除前必须 `removeEventListenersForTarget`。

**为什么：** Cocos2d-x Lua 里触摸 bug 几乎全部源于两个问题：（1）新手混用新旧 API——`layer:setTouchEnabled(true)` 在 3.x 里已废弃，和 EventDispatcher 的优先级体系完全独立，导致点击没响应却不报错，排查极为困难；（2）AI 生成的 Listener 注册了但没有对应的注销，节点 removeChild 后 C++ 对象已析构，触摸事件仍然回调进来，访问已释放的 Lua userdata 直接崩溃。`setSwallowTouches` 设错方向时，弹窗后面的按钮照样可以被点击，产生逻辑混乱。

**怎么做：**
- 统一用 `cc.EventListenerTouchOneByOne:create()` + `eventDispatcher:addEventListenerWithSceneGraphPriority(listener, node)`。
- 弹窗、遮罩层上设 `listener:setSwallowTouches(true)` 拦截穿透；普通 UI 组件默认不吞噬，让事件往下传。
- `onExit` 里：`cc.Director:getInstance():getEventDispatcher():removeEventListenersForTarget(self)`。
- 多层 UI 共存时，用 `addEventListenerWithFixedPriority` 显式指定优先级，避免隐式顺序导致的不确定性。

---

### 3. 调度器：用引擎 scheduler，销毁前一定 unschedule

**规则：** 所有定时逻辑通过 `node:scheduleOnce`、`node:schedule`、或 `cc.Director:getInstance():getScheduler():scheduleScriptFunc` 驱动；不自建基于 update 计数器的"假计时器"；节点销毁前调用 `node:unscheduleAllCallbacks()`。

**为什么：** AI 非常喜欢用 `update` 函数加计数器模拟延迟：`self._timer = self._timer + dt; if self._timer > 3 then ... end`——这在单个节点上无害，但一旦复制粘贴到十几个节点，每帧十几次浮点运算加分支判断，且计时器状态分散在各节点，调试时完全看不出谁在计时。更严重的问题：节点销毁后 update 仍在跑（因为 `node:unscheduleUpdate()` 没调），访问 `self` 的字段引发 attempt to index a nil value，崩溃栈指向引擎内部，新手完全不知道根因。

**怎么做：**
- 延迟执行：`self:scheduleOnce(function() ... end, delay)`。
- 定期执行：`self:schedule(function() ... end, interval)`，返回值保存备用。
- `onExit` 或销毁前：`self:unscheduleAllCallbacks()`——一句话清除该节点上所有定时器。
- 需要跨节点的全局定时（如帧同步心跳），挂到场景根节点或专用 Manager 单例，不挂 UI 节点。

---

### 4. 动作复用：clone 而非共享，减少每帧临时对象

**规则：** 同一个 Action 实例不能同时挂给多个节点——必须 `action:clone()`；`Sequence`、`Spawn`、`RepeatForever` 包装的动作链，每次 `runAction` 前都要 clone；高频创建的动作（如 UI 弹跳）缓存模板，运行时 clone 出实例。

**为什么：** Cocos2d-x 的 Action 是有状态对象，共享同一实例给多个节点时，第一个节点跑完动作，第二个节点拿到的是已结束状态的对象，直接跑不动或行为异常。AI 生成批量动画代码时，最常出现 `for i=1,10 do node[i]:runAction(sameAction) end`，前 9 个节点的动作全部失效，只有最后一个正常——而且不报任何错误，纯表现 bug，极难定位。新手则习惯每次 `runAction` 都 `cc.SequenceCreate(...)` 新建，批量动画时大量临时对象涌入 GC。

**怎么做：**
- 批量动画：`for i=1,#nodes do nodes[i]:runAction(template:clone()) end`。
- 缓存模板：`self._bounceTemplate = cc.Sequence:create(cc.ScaleTo:create(0.1,1.2), cc.ScaleTo:create(0.1,1.0))`，复用时 clone。
- 善用 `cc.Spawn` 并行、`cc.Sequence` 串行，减少手动回调链；`cc.CallFunc` 作为 Sequence 最后一步处理完成逻辑。
- 长期循环动画用 `cc.RepeatForever`，节点退出时 `node:stopAllActions()` 清理。

---

### 5. Lua 内存：闭包引用、全局表污染、大对象置 nil

**规则：** 闭包会隐式持有上值（upvalue），持有大对象或节点引用时会阻止 GC；全局变量挂到 `_G` 会在整个生命周期存活；大型数据（地图数据、关卡配置）用完后显式置 `nil` 并调用 `collectgarbage("collect")`。

**为什么：** Lua 的 GC 是标记清除，只要有引用链就不释放。AI 生成代码时常见的闭包陷阱：`local data = loadBigTable(); node:schedule(function() use(data) end, 1)`——data 被 schedule 的回调闭包持有，节点销毁后如果 schedule 没清理，data 永远不被 GC，直到进程结束。更常见的是全局表污染：`Manager = {}; Manager.data = loadBigTable()`，换场景后 Manager 仍在 `_G` 里，data 占着内存，新手完全意识不到"换场景内存没降"的原因在这里。移动端内存预算只有 400-600MB，这类泄漏积累几个场景后直接被 OS 杀进程。

**怎么做：**
- 场景局部数据用 `local`，不挂 `_G`；模块用 `require` 返回局部表，不污染全局命名空间。
- 大数据生命周期与场景绑定：场景 `onExit` 里 `self._bigData = nil`；若挂在全局 Manager，场景退出时 `Manager.clearSceneData()`。
- 闭包持有的外部对象，在不需要时显式断引用：`local ref = node; node:schedule(function() if ref then ref:doSomething() end end, 1); -- 退出时 ref = nil 并 unschedule`。
- 调试时用 `print(collectgarbage("count"))` 对比场景进出前后的内存，确认无泄漏。

---

## 正例 / 反例

### 反例：调度器不清理 + 旧版触摸 API

```lua
-- 反例 — 旧 API 触摸 + 调度器泄漏
local MyLayer = class("MyLayer", function()
    return cc.Layer:create()
end)

function MyLayer:init()
    self:setTouchEnabled(true)          -- ❌ 3.x 废弃 API，与 EventDispatcher 不兼容
    self:setTouchMode(cc.TOUCH_MODE_ONE_BY_ONE)

    -- ❌ update 里模拟计时器，且 update 退出不清理
    self._timer = 0
    self:scheduleUpdate(function(dt)
        self._timer = self._timer + dt
        if self._timer > 2 then
            self:onTimerFired()
            self._timer = 0
        end
    end)
    -- onExit 里什么也没做 — 调度器泄漏
end
```

```lua
-- 正例 — 新 EventListener + schedule + onExit 清理
local MyLayer = class("MyLayer", function()
    return cc.Layer:create()
end)

function MyLayer:init()
    -- ✅ 用 EventDispatcher 注册触摸
    local listener = cc.EventListenerTouchOneByOne:create()
    listener:setSwallowTouches(false)
    listener:registerScriptHandler(function(touch, event)
        self:onTouchBegan(touch); return true
    end, cc.Handler.EVENT_TOUCH_BEGAN)
    cc.Director:getInstance():getEventDispatcher()
        :addEventListenerWithSceneGraphPriority(listener, self)

    -- ✅ 用 scheduleOnce 替代手动计时
    self:scheduleOnce(function() self:onTimerFired() end, 2)

    return true
end

function MyLayer:onExit()
    -- ✅ 退出时清理所有调度器和事件监听器
    self:unscheduleAllCallbacks()
    cc.Director:getInstance():getEventDispatcher()
        :removeEventListenersForTarget(self)
end
```

---

### 反例：Action 共享实例 + 闭包内存泄漏

```lua
-- 反例 — 共享 Action 实例，闭包持有大数据
local sharedAction = cc.ScaleTo:create(0.3, 1.2)  -- ❌ 单例 Action

local MapData = loadHugeMapConfig()               -- 大数据

for i = 1, #self._icons do
    self._icons[i]:runAction(sharedAction)         -- ❌ 同一实例给多个节点，只有最后一个有效
end

-- ❌ 闭包持有 MapData，场景退出后 MapData 无法 GC
self:schedule(function()
    renderMinimap(MapData)
end, 0.5)
```

```lua
-- 正例 — clone Action，闭包引用随场景清理
local actionTemplate = cc.ScaleTo:create(0.3, 1.2)  -- ✅ 模板只创建一次

for i = 1, #self._icons do
    self._icons[i]:runAction(actionTemplate:clone()) -- ✅ 每个节点独立实例
end

local mapData = loadHugeMapConfig()                  -- local 变量，生命周期可控
self:schedule(function()
    if mapData then renderMinimap(mapData) end
end, 0.5)

function self:onExit()
    self:unscheduleAllCallbacks()    -- ✅ 停止 schedule，闭包释放，mapData 可 GC
    mapData = nil                    -- ✅ 显式断引用
end
```

---

## 自查清单

- [ ] 所有调度器注册在 `onEnter`，并在 `onExit` 里 `unscheduleAllCallbacks()` 清理。
- [ ] 触摸事件使用 `cc.EventListenerTouchOneByOne` 新 API，节点退出时 `removeEventListenersForTarget`。
- [ ] 批量 `runAction` 前对模板调用了 `:clone()`，没有多节点共享同一 Action 实例。
- [ ] 没有用 update 计数器模拟定时，延迟逻辑用 `scheduleOnce`，周期逻辑用 `schedule`。
- [ ] 场景级大数据（配置表、地图数据）在 `onExit` 里置 `nil` 断开引用，可 GC 回收。
- [ ] 闭包里捕获的外部节点/数据引用，都有对应的释放路径（unschedule 或置 nil）。
- [ ] 用 `collectgarbage("count")` 对比场景进出前后内存，确认无明显泄漏。
