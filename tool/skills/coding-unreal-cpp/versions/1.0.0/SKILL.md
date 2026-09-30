---
name: unreal-cpp
description: 写 Unreal C++/蓝图时使用。UObject/GC、反射宏、Tick 性能、蓝图边界。
category: gamedev
tags: [unreal, cpp, 蓝图]
---

# Unreal C++/蓝图

## 何时用

- 新建或修改任何继承自 UObject/AActor/UActorComponent 的 C++ 类时。
- 给蓝图暴露 C++ 函数或属性，或从 C++ 调用蓝图事件时。
- Actor 的 Tick 频率、Timer、委托连接有疑问时。
- 划分哪些逻辑该放 C++、哪些留给蓝图时。
- 遇到偶发崩溃、GC 踢掉对象、野指针问题时。

## 核心规则

### 1. UObject 与 GC：UPROPERTY() 是安全绳

**规则：** 所有持有 UObject 派生类（Actor、Component、Asset 等）的成员变量，必须加 `UPROPERTY()`；弱引用用 `TWeakObjectPtr`；原生裸指针不做持有。

**为什么——真实会犯的错：**
在 `.h` 里写了 `AEnemy* CachedEnemy;` 没加 `UPROPERTY()`，开发期看起来没问题，进入关卡切换或 GC 整理周期后，引擎把 `CachedEnemy` 回收了，下一帧 `CachedEnemy->TakeDamage(...)` 直接崩溃。Crash log 里只有 `Access violation`，根本看不出是 GC 问题，排查半天。

**怎么做：**
- 成员变量持有 UObject 子类 → 加 `UPROPERTY()`（至少空括号），让 GC 追踪引用计数。
- 不希望阻止 GC 回收（如缓存目标但目标销毁时自动置 null）→ 用 `TWeakObjectPtr<AEnemy>`，使用前先 `IsValid()`。
- 函数局部变量、函数参数、返回值不需要 `UPROPERTY()`，GC 周期内不会出问题。
- 禁止用裸指针做持有，`new UObject()` 也不要手动调，用 `NewObject<T>()` 或 `SpawnActor<T>()`。

---

### 2. 反射宏：按需标注，不滥标

**规则：** `UCLASS`/`UFUNCTION`/`UPROPERTY` 只在真正需要反射、蓝图互操时标注；不把所有东西都往蓝图暴露。

**为什么——真实会犯的错：**
把所有函数都加 `BlueprintCallable`、所有变量都加 `EditAnywhere`，编译时间膨胀，蓝图节点列表被几百个无意义函数污染，策划误用了不该在蓝图调的内部函数，出现生命周期顺序问题。另一个常见错误：忘记在 `UFUNCTION()` 里标 `BlueprintImplementableEvent` 却在 C++ 里给了函数体，导致链接错误，新手往往不知道该怎么修。

**怎么做：**
- 只给蓝图**调用**的函数加 `BlueprintCallable`；只给蓝图**重写**的函数加 `BlueprintImplementableEvent` 或 `BlueprintNativeEvent`。
- `BlueprintImplementableEvent` 的 C++ 函数**不能有函数体**；`BlueprintNativeEvent` 的实现写在 `FuncName_Implementation` 里。
- 纯 C++ 内部函数不加任何蓝图标记，保持私有或 protected。
- 变量只在需要编辑器/蓝图访问时才加 `EditAnywhere`/`BlueprintReadWrite`；运行时内部状态加 `Transient` 或不标。

---

### 3. Tick 性能：默认关，按需开

**规则：** Actor/Component 创建时默认设 `PrimaryActorTick.bCanEverTick = false`；确实需要逐帧逻辑再开，并评估能否用 Timer 或事件替代。

**为什么——真实会犯的错：**
场景里生成了 300 个 `ABullet`，每颗子弹的 Tick 里做了一次 `LineTrace`，帧率掉到 20 fps，Profiler 里看到几百条 `ABullet::TickComponent` 占满 CPU。这些子弹大多数时间都在直线飞行，根本不需要每帧 LineTrace——改成 `SetActorTickInterval(0.05f)` 或抛给 Projectile Movement Component 之后帧率立刻回来了。

**怎么做：**
- 构造函数里 `PrimaryActorTick.bCanEverTick = false` 作为默认值。
- 需要倒计时、延迟、周期回调 → 用 `GetWorldTimerManager().SetTimer()`，比 Tick 里减计数更清晰。
- 需要响应状态变化 → 用 Delegate/Event，而不是 Tick 里每帧 poll。
- 确实需要 Tick 时，用 `PrimaryActorTick.TickInterval` 降低频率；或在运行时 `SetActorTickEnabled(false)` 关掉不活跃对象的 Tick。

---

### 4. C++ 与蓝图边界：性能逻辑下沉，配置逻辑上浮

**规则：** 性能敏感、核心计算逻辑放 C++；数值调参、流程编排、视觉表现留蓝图；不在蓝图里写复杂循环或频繁调用的重计算。

**为什么——真实会犯的错：**
策划在蓝图里写了一段「扫描半径内所有敌人并按距离排序」的逻辑，用蓝图 ForLoop + GetAllActorsOfClass，每帧执行，场景有 200 个敌人时帧率腰斩。换成 C++ 用空间查询 `OverlapMultiByChannel` 之后性能恢复正常。另一个方向的错误：程序把所有技能参数写死在 C++ 里，策划调个伤害值要重新编译，浪费大量来回时间。

**怎么做：**
- 碰撞检测、寻路、战斗计算、状态机转移 → C++。
- 技能流程编排、动画触发时机、UI 显示逻辑、数值参数 → 蓝图或 DataAsset。
- 蓝图里的循环如果在 Tick 或高频路径上，先问：「这段能挪到 C++ 吗？」
- 用 `UPROPERTY(EditDefaultsOnly)` 把 C++ 的可调参数暴露给蓝图默认值编辑，而不是写死常量。

---

### 5. 命名与模块：前缀、IWYU、依赖隔离

**规则：** 严格遵守 Unreal 命名前缀（`A`/`U`/`F`/`E`/`I`），头文件只包含真正依赖的头，模块间依赖在 `.Build.cs` 里显式声明。

**为什么——真实会犯的错：**
在 `FPlayerData` 前面忘了加 `F`，写成 `PlayerData`，和蓝图变量名冲突，反射系统报警告且行为诡异。另一个常见事故：在 `.h` 里 `#include "Engine.h"` 图省事，导致增量编译时几乎所有 `.cpp` 都重编，编译时间从 30 秒变 5 分钟。还有在 A 模块直接 `#include` B 模块的私有头而不在 `.Build.cs` 添加依赖，本地能编过，CI 上缺头文件报错。

**怎么做：**
- 类命名前缀：继承 AActor → `A`；继承 UObject → `U`；纯 C++ 结构体 → `F`；枚举 → `E`；接口 → `I`。
- 头文件遵守 IWYU（Include What You Use），只 include 本文件真正用到的头，其余用前向声明。
- 跨模块引用 → 在 `依赖方.Build.cs` 的 `PublicDependencyModuleNames` 或 `PrivateDependencyModuleNames` 里添加被依赖模块，不能靠传递依赖碰运气。

---

## 正例 / 反例

### 反例：裸指针持有 + 忘关 Tick

```cpp
// ❌ 反例 — 裸指针没有 UPROPERTY，GC 随时可能回收；Tick 默认开着
UCLASS()
class AWeapon : public AActor
{
    GENERATED_BODY()
public:
    AWeapon();

    ACharacter* OwnerCharacter;   // ❌ 裸指针，GC 不追踪，随时野指针崩溃

    virtual void Tick(float DeltaTime) override;  // ❌ 什么都不做却每帧执行
};

AWeapon::AWeapon()
{
    // 没有关 Tick，默认开着
}

void AWeapon::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);
    // 空的，白白占 CPU
}
```

### 正例：UPROPERTY + 默认关 Tick + 事件驱动

```cpp
// ✅ 正例 — UPROPERTY 保护引用；默认关 Tick；需要周期逻辑用 Timer
UCLASS()
class AWeapon : public AActor
{
    GENERATED_BODY()
public:
    AWeapon();

    UPROPERTY()
    ACharacter* OwnerCharacter;   // ✅ GC 追踪，销毁时自动置 null

    UPROPERTY(EditDefaultsOnly, Category="Combat")
    float FireCooldown = 0.5f;    // ✅ 参数暴露给蓝图，策划可调

    UFUNCTION(BlueprintCallable, Category="Combat")
    void StartFire();

private:
    FTimerHandle FireTimerHandle;

    void OnFireTick();
};

AWeapon::AWeapon()
{
    PrimaryActorTick.bCanEverTick = false;  // ✅ 默认关，不浪费 CPU
}

void AWeapon::StartFire()
{
    GetWorldTimerManager().SetTimer(
        FireTimerHandle, this, &AWeapon::OnFireTick,
        FireCooldown, true);  // ✅ Timer 替代 Tick，频率可控
}
```

---

## 自查清单

- [ ] 所有持有 UObject 子类的成员变量都加了 `UPROPERTY()`，没有裸指针持有。
- [ ] 构造函数里 `PrimaryActorTick.bCanEverTick = false`，或有明确理由开启 Tick。
- [ ] 蓝图可调参数用 `UPROPERTY(EditDefaultsOnly)` 暴露，没有写死常量。
- [ ] `BlueprintImplementableEvent` 的 C++ 函数无函数体；`BlueprintNativeEvent` 的实现在 `_Implementation` 里。
- [ ] 头文件遵守 IWYU，没有 `#include "Engine.h"` 或其他大而全的万能头。
- [ ] 类名前缀正确（A/U/F/E/I），跨模块依赖已在 `.Build.cs` 显式声明。
- [ ] 性能敏感逻辑在 C++ 里，蓝图里没有在高频路径上跑的复杂循环。
