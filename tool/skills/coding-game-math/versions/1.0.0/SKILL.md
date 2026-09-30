---
name: game-math
description: 写移动/碰撞/相机等游戏逻辑时使用。向量、插值、帧率无关。
category: gamedev
tags: [数学, 向量, 插值]
---

# 游戏数学与手感

## 何时用

- 写角色移动、跳跃、相机跟随、射弹轨迹等任何和空间运动相关的逻辑之前。
- 发现帧率一高角色移动变快、帧率一低角色移动变慢的 bug 时。
- 实现平滑跟随相机、技能预测线、瞄准辅助、敌人转向等涉及插值或旋转的功能时。
- 出现角色卡墙、穿墙、碰撞检测时有时不准等物理/几何问题时。

## 核心规则

### 1. 所有移动与计时必须乘 deltaTime，物理用固定步长

**规则：** 角色位移、速度积分、冷却计时等所有随时间变化的量，必须乘以当前帧的 `deltaTime`；物理模拟（刚体、碰撞）必须在固定步长的 `FixedUpdate`（或等效接口）中执行，不能放在可变帧率的 `Update` 里。

**为什么：** 最经典的错误：`transform.position += speed * Vector3.forward`——忘了乘 `deltaTime`。60fps 时移动速度正常，玩家开了高刷屏（144fps）变成 2.4 倍速，开了垂直同步卡到 30fps 就像踩了泥。更隐蔽的版本：冷却计数器 `cooldown -= 1`（每帧减 1），在 60fps 下 1 秒冷却感觉正确，在 120fps 下只有 0.5 秒——平衡性被帧率破坏。物理放在 `Update` 里的后果：帧率波动导致碰撞检测不稳定，高速物体（子弹）会穿过薄墙（Tunneling）。

**怎么做：**
```csharp
// Unity 示例
void Update() {
    // ✅ 位移乘 deltaTime，帧率无关
    transform.position += velocity * Time.deltaTime;

    // ✅ 冷却计时乘 deltaTime
    if (cooldown > 0) cooldown -= Time.deltaTime;

    // ❌ 不乘 deltaTime，帧率越高移动越快
    // transform.position += velocity;
}

void FixedUpdate() {
    // ✅ 物理/碰撞在固定步长中处理
    rb.AddForce(jumpForce * Vector3.up);
}
```
- 自研引擎同理：物理循环用固定 `dt`（如 1/60s），渲染循环用实际帧间隔；物理步长和渲染步长解耦。

---

### 2. 用引擎向量 API，分清世界坐标与本地坐标

**规则：** 向量运算（归一化、点积、叉积、投影）全部使用引擎提供的 Vector API，禁止自己手写 `sqrt` 计算距离再归一化；坐标空间转换（世界 ↔ 本地 ↔ 屏幕）必须明确，不能混用。

**为什么：** 手写归一化的经典 bug：`float len = sqrt(x*x + y*y); dir = (x/len, y/len)`——当向量长度接近零时除以近零值，结果爆成 NaN 或 Infinity，角色瞬间飞到无穷远处。坐标空间混用更隐蔽：把角色的 `transform.forward`（世界坐标方向）直接当本地坐标方向使用，角色一旋转就方向全乱。

**怎么做：**
```csharp
// 反例 — 手写归一化，零向量时 NaN
float len = Mathf.Sqrt(dir.x * dir.x + dir.y * dir.y);
Vector2 normalized = new Vector2(dir.x / len, dir.y / len);  // ❌ len=0 时 NaN

// 正例 — 使用引擎 API，内置零向量保护
Vector2 normalized = dir.normalized;   // ✅ 零向量时返回 Vector2.zero

// 点积判断是否在前方
float dot = Vector3.Dot(transform.forward, toTarget.normalized);
bool isInFront = dot > 0f;   // ✅ 点积 > 0 表示在正前方半球

// 叉积判断左右
Vector3 cross = Vector3.Cross(transform.forward, toTarget);
bool isOnRight = cross.y > 0f;  // ✅ 叉积 y 分量判断左右（世界上轴为 Y）

// 坐标空间转换要显式
Vector3 worldDir = transform.TransformDirection(localDir);   // 本地 → 世界
Vector3 localDir = transform.InverseTransformDirection(worldDir);  // 世界 → 本地
```

---

### 3. 平滑插值：Lerp/Slerp/SmoothDamp 按场景选对

**规则：** 相机跟随、角色朝向平滑、UI 弹窗动画等需要平滑过渡的场景，必须用 `Lerp`、`Slerp` 或 `SmoothDamp` 实现，禁止写直接赋值的"瞬移"；同时要注意帧率无关写法，`Lerp(a, b, t * dt)` 和 `Lerp(a, b, 0.1f)` 的帧率行为完全不同。

**为什么：** 最常见的手感问题：相机直接 `transform.position = targetPos`，玩家转头时相机像被人抽了一巴掌。用了 `Lerp` 但写成 `Lerp(current, target, 0.1f)` 每帧固定插值，在 60fps 和 30fps 下平滑速度不一样——30fps 时相机变慢，60fps 时变快，高刷屏玩家和低刷屏玩家手感不同。`SmoothDamp` 是跟随类场景的最佳选择，内置帧率无关和速度限制。

**怎么做：**
```csharp
// 相机跟随 — 推荐 SmoothDamp
Vector3 camVelocity = Vector3.zero;  // 必须是成员变量，SmoothDamp 内部维护

void LateUpdate() {
    // ✅ 帧率无关，有最大速度限制，手感最好
    transform.position = Vector3.SmoothDamp(
        transform.position,
        target.position + offset,
        ref camVelocity,
        smoothTime: 0.15f
    );
}

// 旋转平滑 — 用 Slerp 而非 Lerp（Lerp 对四元数会走直线不走球面）
transform.rotation = Quaternion.Slerp(
    transform.rotation,
    targetRotation,
    rotSpeed * Time.deltaTime   // ✅ 乘 deltaTime 帧率无关
);

// 帧率无关的指数平滑（比 Lerp(a,b,0.1f) 更正确）
float alpha = 1f - Mathf.Pow(1f - 0.1f, Time.deltaTime * 60f);
value = Mathf.Lerp(value, target, alpha);
```

---

### 4. 碰撞检测优先用引擎物理或射线，自写检测注意精度与边界

**规则：** 需要碰撞检测时优先使用引擎的 `Raycast`、`OverlapSphere`、`BoxCast` 等 API；确需自写几何检测时（如服务端无物理引擎），必须处理浮点精度（加 epsilon）和边界情况（向量长度为零、完全重合的两点）。

**为什么：** 常见 bug：自写的"子弹是否打中圆形敌人"检测用 `distance < radius`，在距离恰好等于 radius 时因为浮点误差随机成功或失败，导致边缘命中不稳定。更严重的：自写 AABB 碰撞没有处理「一帧内高速穿透」（Tunneling），子弹速度一快就穿墙——引擎的 `SphereCast` 把整个运动轨迹做扫描，天然解决这个问题。

**怎么做：**
```csharp
// 高速子弹用 SphereCast / 扫描射线，而非 OverlapSphere（点采样）
float castRadius = 0.1f;
if (Physics.SphereCast(
        origin: prevPos,
        radius: castRadius,
        direction: (currPos - prevPos).normalized,
        out RaycastHit hit,
        maxDistance: Vector3.Distance(prevPos, currPos),
        layerMask: enemyLayer))
{
    OnBulletHit(hit);   // ✅ 扫描整段轨迹，不会穿墙
}

// 自写 2D 圆形碰撞（带 epsilon 防边界抖动）
const float EPSILON = 0.001f;
bool CircleOverlap(Vector2 a, float ra, Vector2 b, float rb) {
    float distSq = (a - b).sqrMagnitude;           // sqrMagnitude 比 magnitude 快
    float radiusSum = ra + rb + EPSILON;
    return distSq < radiusSum * radiusSum;           // ✅ 避免开方，加 epsilon 处理边界
}
```

---

### 5. 旋转优先用四元数，角度记得归一化

**规则：** 3D 旋转全程使用四元数（Quaternion）而非欧拉角（Euler），只在面向用户的 Inspector 或配置文件中用欧拉角显示；任何角度累加逻辑执行后必须归一化，防止浮点误差积累导致旋转矩阵退化。

**为什么：** 万向锁（Gimbal Lock）是欧拉角在特定姿态下损失一个自由度的现象，飞行游戏和第一人称相机都会碰到：俯仰角到达 ±90° 时，偏航和横滚轴重合，旋转操作失效，相机"锁死"抖动。用四元数就不会有这个问题。另一个常见 bug：每帧累加一个小角度 `euler.y += 0.1f`，几千帧后浮点误差积累，`Quaternion.Euler(euler)` 产生的旋转矩阵不再是单位正交矩阵，物体开始拉伸变形。

**怎么做：**
```csharp
// 反例 — 欧拉角累加，万向锁风险 + 误差积累
transform.eulerAngles += new Vector3(pitch, yaw, 0f);   // ❌

// 正例 — 四元数乘法表示增量旋转
Quaternion deltaRot = Quaternion.Euler(pitch * Time.deltaTime, yaw * Time.deltaTime, 0f);
transform.rotation = transform.rotation * deltaRot;
transform.rotation = Quaternion.Normalize(transform.rotation);  // ✅ 定期归一化防误差积累

// 平滑看向目标
Quaternion lookRot = Quaternion.LookRotation(toTarget, Vector3.up);
transform.rotation = Quaternion.RotateTowards(
    transform.rotation,
    lookRot,
    maxDegreesPerSecond * Time.deltaTime   // ✅ 帧率无关的最大旋转速度
);

// 只读欧拉角、不写欧拉角
float currentYaw = transform.eulerAngles.y;   // 读取用于 UI 显示 OK
// transform.eulerAngles = new Vector3(x, y, z);  // ❌ 避免直接写
```

## 正例 / 反例

### 反例：忘记 deltaTime，角色速度随帧率变化

```csharp
// 反例 — 不乘 deltaTime，帧率越高越快
public class PlayerMove : MonoBehaviour {
    float speed = 5f;

    void Update() {
        float h = Input.GetAxis("Horizontal");
        float v = Input.GetAxis("Vertical");
        transform.position += new Vector3(h, 0, v) * speed;  // ❌ 60fps 正常，144fps 快 2.4 倍
    }
}
```

```csharp
// 正例 — 乘 deltaTime，任何帧率下速度一致
public class PlayerMove : MonoBehaviour {
    float speed = 5f;

    void Update() {
        float h = Input.GetAxis("Horizontal");
        float v = Input.GetAxis("Vertical");
        transform.position += new Vector3(h, 0, v) * speed * Time.deltaTime;  // ✅
    }
}
```

---

### 反例：用欧拉角做相机旋转，仰角 90° 时万向锁

```csharp
// 反例 — 欧拉角累加，俯仰到 90° 时偏航失效
float pitch, yaw;
void Update() {
    pitch += Input.GetAxis("Mouse Y") * sensitivity;
    yaw   += Input.GetAxis("Mouse X") * sensitivity;
    transform.eulerAngles = new Vector3(-pitch, yaw, 0f);  // ❌ pitch=90 时万向锁
}
```

```csharp
// 正例 — 四元数分轴旋转，clamp 俯仰角，无万向锁
float pitch, yaw;
void Update() {
    pitch = Mathf.Clamp(pitch - Input.GetAxis("Mouse Y") * sensitivity, -89f, 89f);
    yaw  += Input.GetAxis("Mouse X") * sensitivity;

    Quaternion pitchRot = Quaternion.AngleAxis(pitch, Vector3.right);
    Quaternion yawRot   = Quaternion.AngleAxis(yaw,   Vector3.up);
    transform.rotation  = yawRot * pitchRot;   // ✅ 四元数组合，无万向锁
}
```

## 自查清单

- [ ] 所有位移、速度积分、冷却计时都乘了 `deltaTime`，没有裸 `+= speed` 或 `+= 1`。
- [ ] 物理/刚体逻辑在 `FixedUpdate`（或固定步长循环）中，不在可变帧率的 `Update` 里。
- [ ] 向量归一化用引擎 API（`.normalized`），没有手写 `sqrt` 且未处理零向量情况。
- [ ] 坐标空间转换（世界/本地/屏幕）有显式转换调用，不存在隐式混用。
- [ ] 平滑跟随/过渡用了 `SmoothDamp` 或帧率无关的 `Lerp` 写法，而非固定系数 `Lerp(a,b,0.1f)`。
- [ ] 高速物体（子弹、快速角色）的碰撞检测用扫描型接口（SphereCast/CCT），不用点采样 OverlapSphere。
- [ ] 3D 旋转用四元数，没有用欧拉角做累加，且在长时间运行的旋转逻辑中有归一化调用。
