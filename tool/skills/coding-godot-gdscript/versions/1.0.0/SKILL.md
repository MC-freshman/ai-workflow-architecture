---
name: godot-gdscript
description: 写 Godot（GDScript/C#）时使用。节点树、signal、场景、性能规范。
category: gamedev
tags: [godot, gdscript, 节点]
---

# Godot

## 何时用

- 新建或修改任何 GDScript 脚本或 C# 组件脚本时。
- 节点间通信方式有疑问（是用 get_node、直接引用还是 signal）时。
- `_process` 和 `_physics_process` 里的逻辑越写越多、帧率下降时。
- 场景实例化、资源加载/释放方式不确定时。
- 遇到内存泄漏、孤立节点、信号未断开等问题时。

## 核心规则

### 1. 节点与场景：@onready 缓存，场景实例化代替继承

**规则：** 节点引用用 `@onready` 在 `_ready()` 阶段一次性缓存；不在 `_process` 里反复 `get_node()`；复用结构用场景实例化，而不是多层继承。

**为什么——真实会犯的错：**
在 `_process(delta)` 里每帧写 `$AnimationPlayer.play("run")`，GDScript 每次都要解析节点路径字符串、在节点树里做查找，场景节点数量一多（几百个）帧率肉眼可见地跌。另一个常见错误：用继承堆叠 Enemy → FlyingEnemy → BossEnemy → FinalBoss，四层下来 `_ready` 调用顺序、信号连接变得极难追踪，改一层上面全乱。

**怎么做：**
- 节点引用用 `@onready var anim: AnimationPlayer = $AnimationPlayer`，只在 `_ready()` 时解析一次路径，后续直接用变量。
- 逻辑上独立、可复用的结构拆成独立场景（`.tscn`），用 `instantiate()` 生成，而不是靠继承叠加。
- `get_node()` 只在 `_ready()`、事件回调里调用，**不放进 `_process` 或 `_physics_process`**。

---

### 2. signal 解耦：通信走信号，连接必须断开

**规则：** 节点间跨层通信用 `signal`；子节点不直接持有父节点引用；场景卸载或节点销毁前断开信号连接，防止内存泄漏和空引用回调。

**为什么——真实会犯的错：**
Enemy 脚本里写了 `get_parent().get_node("HUD").show_damage(damage)`，这条路径硬绑了节点树结构，一旦 HUD 改了层级或名称，运行时立刻报 `null`，且错误信息只提示"尝试调用 null 上的方法"，找来找去才发现是节点路径变了。另一个事故：动态生成的子弹连接了 GameManager 的信号，子弹 `queue_free()` 后没有断开，GameManager 还保持对已销毁节点的引用，触发回调时崩溃或静默错误。

**怎么做：**
- 子节点向上通信 → 发射 `signal`，父节点监听，子节点不引用父节点。
- 跨系统通信 → 用 Autoload（单例）中转，或通过 signal bus。
- 动态节点连接信号时，在 `_exit_tree()` 或 `queue_free()` 前调用 `signal.disconnect(callback)` 断开。
- 用 `connect(..., CONNECT_ONE_SHOT)` 处理只触发一次的事件，自动断开更安全。

---

### 3. _process vs _physics_process：物理归物理，能事件驱动就不轮询

**规则：** 涉及物理体、碰撞、速度的逻辑一律放 `_physics_process(delta)`；纯表现层更新可放 `_process(delta)`；能用信号/事件触发的逻辑不轮询。

**为什么——真实会犯的错：**
在 `_process` 里移动 CharacterBody2D，与物理引擎以不同频率运行，出现抖动和碰撞穿透，在低帧机器上更明显。另一个方向：把大量 UI 状态检测（"玩家血量是否低于 20%"）放在 `_physics_process` 里每帧判断，不必要地占用物理线程。还有把"按下攻击键"的检测放在 `_process` 里，输入延迟和物理帧不对齐，打击感差。

**怎么做：**
- `move_and_slide()`、碰撞查询、刚体速度赋值 → 全进 `_physics_process`。
- 摄像机插值、粒子参数更新等纯视觉逻辑 → 可放 `_process`。
- 玩家输入 → `_unhandled_input()` 或 `_input()` 回调，不在 `_process` 里 poll `Input.is_action_pressed()`（除非需要持续检测，如长按移动）。
- 状态变化通知（血量减少 → 更新 UI）→ 发射 signal，不在 `_process` 里每帧比对旧值。

---

### 4. 静态类型：GDScript 2.0 类型注解全开

**规则：** 所有变量、函数参数、返回值都加类型注解；避免用 `Variant` 做中间传递；禁止用字符串做类型名传给 `get_node()`、`is_class()` 等。

**为什么——真实会犯的错：**
`var speed = 5` 写成动态类型，Godot 运行时每次访问都要推断类型，100 个敌人 × 每帧访问数十次，性能损耗可测量。更常见的问题是可读性：`func deal_damage(target, amount)` 两个参数都是 `Variant`，调用方传错类型（把 `Node` 传给了期望 `float` 的 `amount`），运行时才报错，且错误提示不友好。用了字符串类 `get_node("Player").has_method("take_hit")` 这种动态查找，重构时改了方法名但字符串没改，静默失效。

**怎么做：**
- 变量：`var speed: float = 5.0`，`var health: int = 100`。
- 函数：`func deal_damage(target: CharacterBody2D, amount: float) -> void:`。
- 节点引用：`@onready var player: CharacterBody2D = $Player`，有类型后能享受 IDE 补全和静态检查。
- 回调和信号连接的函数签名也要与信号声明的参数类型一致，不用 `Variant` 兜底。

---

### 5. 资源释放：queue_free 正确时机，避免循环引用

**规则：** 动态生成的节点用 `queue_free()` 释放，不用 `free()`；`preload` 预加载静态资源，`load` 按需加载动态资源；Resource 之间不能循环引用。

**为什么——真实会犯的错：**
在回调函数中直接调 `node.free()`，如果此帧还有其他代码持有该节点的引用并继续调用其方法，立刻崩溃报 `freed object`。用 `queue_free()` 则会等本帧所有逻辑跑完再安全删除。另一个常见问题：两个 Resource（如 WeaponData 和 AbilityData）互相持有对方引用，GDScript 的引用计数无法回收，内存随关卡切换不断增长。

**怎么做：**
- 销毁节点一律用 `queue_free()`，不用 `free()`（除非你清楚知道当前帧没有其他引用）。
- 场景启动时就需要的资源（UI 图、常用音效）→ `preload("res://...")` 编译期绑定。
- 按关卡动态加载的大资源 → `ResourceLoader.load_threaded_request()` 异步加载，避免卡主线程。
- Resource 设计时保证单向依赖，用 NodePath 或 StringName 做弱引用替代直接持有对方 Resource 对象。

---

## 正例 / 反例

### 反例：get_node 在 _process 里 + 硬引用父节点 + 无类型注解

```gdscript
# ❌ 反例 — 每帧解析路径；硬引用父节点；无类型注解
extends Node

func _process(delta):
    # 每帧都在节点树里查找路径字符串，性能差
    $AnimationPlayer.play("idle")

    # 子节点直接拿父节点的子节点，耦合严重
    get_parent().get_node("HUD").update_hp(get_parent().get_node("Player").hp)

func take_damage(amount):  # 参数无类型，调用方传错不报错
    get_parent().get_node("Player").hp -= amount
```

### 正例：@onready 缓存 + signal 解耦 + 静态类型

```gdscript
# ✅ 正例 — onready 缓存；signal 向上通信；全类型注解
extends CharacterBody2D

signal health_changed(new_hp: int)  # 信号携带类型

@onready var anim: AnimationPlayer = $AnimationPlayer  # 一次缓存

var hp: int = 100

func _ready() -> void:
    anim.play("idle")  # 直接用缓存变量，无路径查找

func take_damage(amount: float) -> void:
    hp -= int(amount)
    health_changed.emit(hp)  # 发信号，不直接引用 HUD

func _on_died() -> void:
    queue_free()  # 安全释放，不用 free()
```

---

## 自查清单

- [ ] 节点引用全部用 `@onready` 缓存，`_process` / `_physics_process` 里没有 `get_node()` 调用。
- [ ] 跨节点通信用 signal，子节点没有直接引用父节点或兄弟节点。
- [ ] 物理/碰撞逻辑在 `_physics_process`，纯表现逻辑在 `_process`，状态变化用 signal 通知而非每帧轮询。
- [ ] 所有变量、函数参数、返回值都有 GDScript 2.0 类型注解，没有裸 `Variant`。
- [ ] 动态节点销毁用 `queue_free()`，信号连接在节点退出树前断开。
- [ ] Resource 之间无循环引用；大资源用异步加载，不阻塞主线程。
