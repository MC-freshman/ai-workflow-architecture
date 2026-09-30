---
name: game-performance
description: 优化游戏性能时使用。帧率、GC、Draw Call、对象池、分帧的通用规范。
category: gamedev
tags: [性能, 帧率, 对象池]
---

# 游戏性能优化

## 何时用

- 帧率下降、卡顿、游戏线程或渲染线程占用异常时。
- 准备实现高频生成/销毁对象（子弹、特效、敌人）的功能之前。
- Draw Call 过多、移动端发热、GPU 占用异常时。
- 大地图、远景渲染、大量 AI 同屏出现时。
- 包体超标、加载时间过长、运行时内存持续增长时。

## 核心规则

### 1. 先 Profile，不凭感觉优化

**规则：** 发现性能问题的第一步是开引擎 Profiler，定位瓶颈究竟在 CPU 游戏线程、渲染线程、GPU 还是 GC；确认瓶颈后再动手，不猜测。

**为什么——真实会犯的错：**
帧率跌到 40 fps，直觉上以为是 Draw Call 太多，花两天做合批，结果 Profiler 一开，GPU 占用 30%，真正的问题是游戏线程里每帧跑了一段 O(n²) 的敌人感知逻辑。两天白费，且合批引入了新的材质管理复杂度。还有一种常见误判：以为是 GC 卡顿，把所有对象都对象池化，结果真正问题是 Shader 编译 spike，池化没有任何帮助反而增加了大量代码复杂度。

**怎么做：**
- Unity：Profiler 窗口（CPU/GPU/Memory 标签），配合 Frame Debugger 看 Draw Call。
- Unreal：Unreal Insights 或 `stat unit`/`stat fps`/`stat game`/`stat gpu` 命令，GPU Visualizer 看渲染耗时。
- Godot：Debugger → Monitors 面板，`RenderingServer.get_rendering_info()` 查 Draw Call 数量。
- 优化前记录基准帧时，优化后对比，用数据说话，不用"感觉快了"。

---

### 2. 对象池：高频生成对象一律复用

**规则：** 子弹、爆炸特效、伤害数字、拾取物等生命周期短且高频生成的对象，必须用对象池复用；禁止在游戏主循环中对这类对象频繁 new/instantiate + destroy/queue_free。

**为什么——真实会犯的错：**
射击游戏里每颗子弹都 `Instantiate` + `Destroy`，1 秒 20 发，C# 的 GC 每隔几秒做一次 Gen0 收集，帧时间 spike 到 50ms，玩家感知到明显卡顿。在移动端这个问题更严重，GC pause 动辄 100ms+。关键是这种卡顿**只在长时间游戏后出现**，开发期单次测试根本发现不了，上线后玩家投诉才暴露。

**怎么做：**
- 维护一个对象列表/队列，按需取出（激活）、用完归还（停用），不真正销毁。
- 池的初始大小根据峰值需求预估，宁可多初始化，避免运行时扩容带来的 spike。
- 归还时重置对象状态（位置、速度、生命值、粒子系统），确保下次取出是干净状态。
- Unity 4.7+：`ObjectPool<T>` 内置实现；Godot：手动维护 `Array` 池；Unreal：Actor 池或配合 Niagara 的 GPU 粒子。

---

### 3. 降 Draw Call：合批、图集、共享材质

**规则：** 减少 Draw Call 的核心是让渲染器批处理更多对象：相同材质/纹理的对象合批；UI 元素用图集；避免运行时频繁修改材质参数导致 batch 断开。

**为什么——真实会犯的错：**
UI 界面上 200 个图标，每个图标用独立的 Sprite 图片，200 个 Draw Call 全在 UI 层，移动端帧率卡死。换成图集（Texture Atlas）后降到 3 个 Draw Call，帧率立刻上来。另一个常见错误：代码里动态 `material.SetColor(...)` 修改颜色，Unity 遇到 `SetColor` 会破坏 Static Batching 并触发 `materialInstance` 拷贝，导致原本可以合批的几百个对象全部分开渲染，Draw Call 暴涨。

**怎么做：**
- 相同静态物体启用 Static Batching（Unity）或 ISM/HISM（Unreal）合并网格实例。
- UI 图片用 Sprite Atlas 打包，同一图集内的 Sprite 自动合批。
- 需要运行时改颜色 → 用 MaterialPropertyBlock（Unity）传参，不直接改 material 避免实例化。
- 合批的前提是相同材质，合批前先统计 Draw Call，确认目标之后再做材质合并。

---

### 4. 分帧与 LOD：重活切片，远处降频

**规则：** 耗时的非实时计算（寻路重算、视野检测、大批量 AI 决策）分帧执行或使用时间片；远处对象启用 LOD 降低面数；不在视锥之外的对象关闭 Tick/Update。

**为什么——真实会犯的错：**
100 个 NPC 每帧同时刷新寻路，游戏线程单帧耗时从 2ms 涨到 18ms，超过 16.6ms 预算，帧率掉到 45fps。把寻路更新分散到 10 帧内依次执行（每帧处理 10 个），平均耗时回到 3.8ms，帧率稳了。另一个教训：远处 500 米外的敌人和近处敌人同频 Tick，这些 NPC 玩家根本看不清，却占用了和近处 NPC 等量的 CPU，是纯粹的浪费。

**怎么做：**
- 时间片：维护一个更新队列，每帧只处理队列的 1/N，保证任务在 N 帧内全部完成一轮。
- LOD：Unreal 的 HLOD/LOD Group，Unity 的 LOD Group 组件，Godot 的 VisibilityNotifier + 距离判断。
- 视锥剔除：渲染器自动做，但游戏逻辑层（动画、AI Tick）也要判断 `is_visible_in_tree()` / `IsActorInViewFrustum()`，不在视锥外做计算。
- 距离分级：近距离全频更新，中距离降频（每 3 帧），远距离极低频（每 10 帧）或暂停 AI。

---

### 5. 内存与包体：及时卸载，压缩纹理，控制图集体积

**规则：** 关卡/场景切换时主动卸载不再需要的资源；纹理用压缩格式（ETC2/ASTC/DXT）；图集不能无限增大；音频用流式播放替代全部加载到内存。

**为什么——真实会犯的错：**
手游关卡切换后没有调用资源卸载，前一关的纹理还驻留内存，玩到第三关时内存超 2GB 被系统杀掉。另一个常见包体事故：美术给了 4096×4096 的无损 PNG 做 UI 背景图，没有设置平台压缩格式，一张图 64MB，包体直接超标，且加载时间比 ASTC 压缩版慢 8 倍。背景音乐用 `preload` 全量加载，3 首 BGM 占 120MB 内存，改成流式（AudioStream with stream enabled）后降到 5MB。

**怎么做：**
- 场景卸载时显式调用 `Resources.UnloadUnusedAssets()`（Unity）或 `gc.collect()`（Godot），不依赖运行时自动回收。
- 所有纹理在导入设置里配置平台压缩：移动端 ASTC，PC/主机 DXT5/BC7，不用 RGBA32 原始格式。
- 图集控制在 2048×2048 以内（移动端 1024×1024），超过就拆分多个图集。
- 背景音乐、环境音用流式播放；短音效（<5 秒）才全量加载内存。

---

## 正例 / 反例

### 反例：每帧 Instantiate/Destroy + 无对象池

```csharp
// ❌ 反例（Unity C#）— 每帧生成和销毁子弹，GC 压力极大
public class Gun : MonoBehaviour
{
    public GameObject bulletPrefab;

    void Update()
    {
        if (Input.GetKey(KeyCode.Space))
        {
            // 每帧 new 一个 GameObject，GC 负担
            GameObject bullet = Instantiate(bulletPrefab, firePoint.position, firePoint.rotation);
            Destroy(bullet, 3f);  // 3 秒后销毁，触发 GC
        }
    }
}
```

### 正例：对象池复用 + Unity ObjectPool

```csharp
// ✅ 正例（Unity C#）— ObjectPool 复用子弹，零运行时分配
using UnityEngine.Pool;

public class Gun : MonoBehaviour
{
    public GameObject bulletPrefab;
    private ObjectPool<Bullet> _pool;

    void Awake()
    {
        _pool = new ObjectPool<Bullet>(
            createFunc:    () => Instantiate(bulletPrefab).GetComponent<Bullet>(),
            actionOnGet:   b => b.gameObject.SetActive(true),
            actionOnRelease: b => b.gameObject.SetActive(false),
            defaultCapacity: 30
        );
    }

    void Update()
    {
        if (Input.GetKey(KeyCode.Space))
        {
            Bullet b = _pool.Get();          // ✅ 从池取，无 GC 分配
            b.Init(firePoint.position, firePoint.rotation, _pool);
        }
    }
}

public class Bullet : MonoBehaviour
{
    private ObjectPool<Bullet> _pool;

    public void Init(Vector3 pos, Quaternion rot, ObjectPool<Bullet> pool)
    {
        transform.SetPositionAndRotation(pos, rot);
        _pool = pool;
        Invoke(nameof(ReturnToPool), 3f);
    }

    void ReturnToPool() => _pool.Release(this);  // ✅ 归还池，不 Destroy
}
```

---

## 自查清单

- [ ] 动手优化前已用引擎 Profiler 确认瓶颈（CPU/GPU/GC/Draw Call），不凭感觉。
- [ ] 高频生成/销毁的对象（子弹、特效、拾取物）使用对象池，主循环中无 Instantiate + Destroy。
- [ ] UI 图片打了 Sprite Atlas；运行时改颜色用 MaterialPropertyBlock，不直接改 material。
- [ ] 非实时的重计算（寻路、AI 决策）做了分帧/降频处理；视锥外对象关闭 Tick。
- [ ] 所有纹理配置了平台压缩格式；背景音乐使用流式播放；场景切换后主动卸载资源。
- [ ] 优化前后有帧时间数据对比，能定量说明改动的效果。
