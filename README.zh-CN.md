# dsh-credit-expiry

面向 DeepSeek Harness (dsh) 的**纯客户端**独立插件。在左侧边栏新增一个
**「积分到期」** 面板，展示未来 **7 天**各渠道**按天分组**的到期积分，含合计
与手动刷新按钮。

它读取 dsh-xdpool 现有的 HTTP 端点（`/plugins/dsh-xdpool/status` 与
`/api/channel-pack`），并**不修改** `dsh-xdpool`，因此在 xdpool 升级后也不会被覆盖。

## 依赖

- 正在运行的 dsh **web** profile（本插件仅浏览器端，`platform: "web"`）。
- 该 profile 已安装并启用 **dsh-xdpool**（≥ 2.6.1）作为数据源；没有 xdpool 时
  面板会显示错误/空状态。

## 安装

```bash
# 从 GitHub 源码（分支 HEAD tarball）
dsh plugin add github:<owner>/dsh-credit-expiry

# 或发布到 npm 后
dsh plugin add dsh-credit-expiry
```

安装后重启 web profile，从侧边栏打开 **「积分到期」** 面板即可。

## 原理

- 从 `GET /plugins/dsh-xdpool/status?region=cn|global` 读取 pool 账户内
  `expiresAtMs` 的积分包。
- 通过 `POST /api/channel-pack` 的 `credits.balances` 取得各渠道积分包
  （`remaining` + `deductionEndTime`/`expiredTime`）。
- 仅保留 `now < 到期 <= now + 7d` 的包，按本地日期分桶、按渠道求和
  （`unit` 可能是 `credits`/`tokens`/`dollars`）。

> 注意：部分渠道（如 qoder 资源包）上游不返回到期日，这类包会如实不显示。

## License

MIT — 见 [LICENSE](LICENSE)。