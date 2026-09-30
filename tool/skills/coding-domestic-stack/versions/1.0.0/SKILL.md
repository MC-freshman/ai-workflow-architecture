---
name: domestic-stack
description: 写 uniapp / 微信小程序 / SpringBoot 代码时使用。贴合国内主流技术栈的实战规范。
category: china
tags: [uniapp, 小程序, springboot]
---

# 国内技术栈适配

## 何时用

- 开发微信小程序或 uniapp 项目，涉及页面、组件、API 调用时。
- 写 uniapp 多端适配逻辑，需要区分 APP / 小程序 / H5 平台差异时。
- 开发 SpringBoot 后端接口，涉及 Controller / Service / Mapper 分层设计时。
- 项目上线前检查合规、依赖源、CDN 等国内环境配置时。

## 核心规则

### 1. 小程序/uniapp 不照搬 web

**规则：** 微信小程序和 uniapp 运行在专属运行时，没有 `window`、`document`、`localStorage` 等 DOM/BOM 对象；`setData` 是性能敏感操作，频繁调用或传大对象会直接卡顿；整包 + 分包体积有硬性上限（主包 2 MB，总包 20 MB）。

**为什么：** AI 训练数据以 web 代码为主，极容易写出 `document.querySelector`、`window.location.href`、`localStorage.setItem` 这类在小程序里直接报 `ReferenceError` 的代码。对 `setData` 的误用更隐蔽：AI 常常在循环里每次更新一个字段就调用一次 `setData`，或者把整个巨型列表塞进去，运行时帧率立刻掉到个位数。

**怎么做：**
- 访问本地存储用 `wx.setStorageSync` / `uni.setStorageSync`，路由用 `wx.navigateTo` / `uni.navigateTo`，DOM 操作改用数据绑定驱动视图。
- 批量更新时合并成一次 `setData`，用 path 精确更新而非替换整个对象（见正例）。
- 拆分包：业务模块放分包，避免主包塞太多资源；图片走 CDN 不打进包里。

---

### 2. uniapp 跨端用条件编译

**规则：** uniapp 跨 APP / 微信小程序 / H5 时，平台差异必须用 `#ifdef APP-PLUS` / `#ifdef MP-WEIXIN` / `#ifdef H5` 等条件编译块处理，不写死只在单端能跑的逻辑。

**为什么：** AI 在生成 uniapp 代码时经常直接调用 `wx.*` API 而不加条件编译，在 APP 端或 H5 端运行时这些调用会静默失败或抛异常。反过来也会犯：只写了 `plus.*` 的 APP 专属逻辑，发布 H5 版时整块功能缺失。这类 bug 在单端开发阶段完全看不出来，到多端上线时才暴露。

**怎么做：**
- 平台专属 API 用条件编译包裹，公共逻辑放在块外。
- 样式差异用 `/* #ifdef MP-WEIXIN */` 包裹对应 CSS。
- 构建产物检查：每次改动后分别在小程序、H5 模式各跑一遍，确认两端都正常。

---

### 3. 微信登录走官方流程

**规则：** 微信登录必须走 `wx.login` 获取 code，再由后端调用 `code2session` 换取 openid 和 session_key；openid 和 session_key 不得存在前端，不得绕过授权步骤直接用 union_id 或手机号作为身份标识。

**为什么：** AI 经常写出把 `session_key` 存进 `wx.setStorageSync` 的代码——这违反微信安全规范，session_key 会失效且不能直接暴露给客户端。还有一种常见错误：前端直接拿 `getUserInfo` 返回的 `openid`（旧接口早已废弃）当登录凭证，绕过后端校验，既不安全也不符合现行微信能力。

**怎么做：**
- 前端只负责：`wx.login` → 拿到 code → 发给自己后端。
- 后端用 appid + appsecret + code 请求微信 `code2session` 接口，换回 openid / session_key，生成自己的登录态 token 返回前端。
- 前端持久化自己后端颁发的 token，不存 openid，不存 session_key。
- 需要手机号时走 `getPhoneNumber` 组件 + 后端解密，不走已废弃的 `getUserInfo`。

---

### 4. SpringBoot 分层清晰

**规则：** Controller 只做参数接收与响应封装，业务逻辑全部下沉到 Service，数据库操作放 Mapper / Repository；统一异常处理用 `@ControllerAdvice`，参数校验用 `@Valid` + ConstraintValidator，不在 Controller 里写业务代码。

**为什么：** AI 写 SpringBoot 时极其容易把业务逻辑堆在 Controller 里——直接在 `@GetMapping` 方法里查库、算价格、拼 SQL——表面上能跑，但单元测试无法覆盖（Controller 层的业务很难 mock），复用性为零，后续需求一变就到处改。参数校验也常被忽略，AI 会直接用 `if (name == null)` 手写 if-else，而不是用注解在入口统一拦截。

**怎么做：**
- Controller 方法体只保留：调 Service、封装响应（`ResponseEntity` / 统一 `Result<T>`）。
- Service 接口 + 实现类分离，业务逻辑全在实现类里，便于 mock 测试。
- 参数校验用 `@NotNull`、`@Size`、`@Pattern` 等注解 + `@Valid`，统一在 `@ControllerAdvice` 里捕获 `MethodArgumentNotValidException`。
- 自定义业务异常继承 `RuntimeException`，在 `@ControllerAdvice` 里集中处理，返回标准错误格式。

---

### 5. 合规与网络意识

**规则：** 国内上线项目必须具备 ICP 备案、隐私政策、必要的数据合规措辞；npm 依赖用淘宝镜像（`registry.npmmirror.com`），Maven 依赖用阿里云镜像（`maven.aliyun.com`）；静态资源走国内 CDN，不直接引用境外 CDN 地址。

**为什么：** AI 生成的项目配置默认指向境外镜像（`registry.npmjs.org`、`repo.maven.apache.org`），在国内 CI/CD 环境里拉包极慢甚至超时，导致构建失败。更严重的是 AI 生成的 HTML 模板常常引用 `cdn.jsdelivr.net` 或 `unpkg.com`，这些域名在国内访问不稳定，直接造成生产页面资源加载失败。隐私合规方面，AI 不会自动提醒你"需要 ICP 备案"或"用户协议需要说明数据收集范围"，这些遗漏可能导致应用被下架。

**怎么做：**
- `.npmrc` 或 `package.json` 的 `publishConfig` 指向淘宝镜像；`settings.xml` 的 `<mirror>` 指向阿里云。
- 前端静态资源（图片、字体、第三方 JS）走国内 CDN，境外 CDN 链接一律替换。
- 小程序上架、App 上线前对照工信部/苹果/安卓平台的合规清单检查隐私政策、用户协议、权限申请说明。

---

## 正例 / 反例

### 小程序：setData 全量替换 vs 局部 path 更新

```javascript
// 反例 — 每次只改一个字段，却替换整个列表对象，触发全量 diff + 全量渲染
Page({
  data: {
    list: [
      { id: 1, name: '商品A', count: 0 },
      { id: 2, name: '商品B', count: 0 },
    ]
  },
  addCount(index) {
    const list = this.data.list
    list[index].count += 1
    this.setData({ list })   // ❌ 传整个数组，无论列表多大都全量更新
  }
})
```

```javascript
// 正例 — 用 path 语法精确更新变化的字段，渲染开销最小
Page({
  data: {
    list: [
      { id: 1, name: '商品A', count: 0 },
      { id: 2, name: '商品B', count: 0 },
    ]
  },
  addCount(index) {
    const key = `list[${index}].count`
    this.setData({
      [key]: this.data.list[index].count + 1   // ✅ 只更新变化的路径，性能最优
    })
  }
})
```

---

### uniapp：条件编译处理平台差异

```javascript
// 反例 — 直接调用 wx.* API，APP 端和 H5 端运行时报错
export function saveToken(token) {
  wx.setStorageSync('token', token)   // ❌ APP 端没有 wx 对象，直接 ReferenceError
}
```

```javascript
// 正例 — 用 uni.* 统一 API + 条件编译处理真正有差异的部分
export function saveToken(token) {
  uni.setStorageSync('token', token)   // ✅ uni.* 在所有端均可用

  // #ifdef APP-PLUS
  // APP 端额外写入原生 keychain（示例）
  plus.storage.setItem('token', token)
  // #endif
}
```

---

### SpringBoot：业务逻辑堆在 Controller vs 正确分层

```java
// 反例 — Controller 直接查库、写业务、手写 if-else 校验，什么都往里塞
@RestController
@RequestMapping("/order")
public class OrderController {

    @Autowired
    private OrderMapper orderMapper;

    @PostMapping("/create")
    public Map<String, Object> createOrder(@RequestBody Map<String, Object> body) {
        // ❌ 参数校验手写 if-else
        if (body.get("userId") == null || body.get("amount") == null) {
            return Map.of("code", 400, "msg", "参数缺失");
        }
        // ❌ 业务逻辑直接在 Controller 里算
        double amount = Double.parseDouble(body.get("amount").toString());
        if (amount <= 0) {
            return Map.of("code", 400, "msg", "金额非法");
        }
        // ❌ 直接调 Mapper，绕过 Service 层
        orderMapper.insert(body.get("userId"), amount);
        return Map.of("code", 200, "msg", "创建成功");
    }
}
```

```java
// 正例 — Controller 只接参/返响应；业务在 Service；校验用注解统一处理

// DTO：用注解声明校验规则
public class CreateOrderRequest {
    @NotNull(message = "userId 不能为空")
    private Long userId;

    @Positive(message = "金额必须大于 0")
    private Double amount;
    // getter / setter 省略
}

// Controller：只负责接参、调 Service、封装响应
@RestController
@RequestMapping("/order")
public class OrderController {

    @Autowired
    private OrderService orderService;

    @PostMapping("/create")
    public Result<Long> createOrder(@Valid @RequestBody CreateOrderRequest req) {
        // ✅ 校验由 @Valid 在入口统一拦截，Controller 无需 if-else
        Long orderId = orderService.createOrder(req);
        return Result.ok(orderId);
    }
}

// Service：业务逻辑全在这里
@Service
public class OrderServiceImpl implements OrderService {

    @Autowired
    private OrderMapper orderMapper;

    @Override
    public Long createOrder(CreateOrderRequest req) {
        // ✅ 业务逻辑集中，可独立单测
        Order order = new Order(req.getUserId(), req.getAmount());
        orderMapper.insert(order);
        return order.getId();
    }
}

// 全局异常处理：统一捕获校验异常，返回标准格式
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public Result<Void> handleValidation(MethodArgumentNotValidException ex) {
        String msg = ex.getBindingResult().getFieldErrors()
                .stream().map(FieldError::getDefaultMessage)
                .collect(Collectors.joining("; "));
        return Result.fail(400, msg);   // ✅ 统一错误格式，前端好处理
    }
}
```

---

## 自查清单

- [ ] 代码里没有出现 `window`、`document`、`localStorage`——已换成小程序/uniapp 对应的 API。
- [ ] 所有 `setData` 调用都经过合并，且使用 path 语法只更新变化的字段，没有在循环里多次调用。
- [ ] uniapp 中所有平台差异逻辑都用 `#ifdef` 条件编译包裹，没有写死单端 API。
- [ ] 微信登录流程：前端只传 code 给后端，openid / session_key 不落前端存储。
- [ ] SpringBoot Controller 方法体只有调 Service 和返回响应，没有业务逻辑和直接的 Mapper 调用。
- [ ] 参数校验使用注解 + `@ControllerAdvice` 统一处理，没有散落的手写 if-else 校验。
- [ ] `package.json` / `settings.xml` 已配置国内镜像源，前端资源没有引用境外 CDN 链接。
