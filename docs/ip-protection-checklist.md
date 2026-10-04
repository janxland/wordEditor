# 防技术盗窃 · 上线前检查单

> 这份清单的作用：**在你把仓库开出去之前，把"能被白嫖的部分"收到最小**。
> 每项都写了为什么、以及不做会怎样。

## 当前状态（2026-10-03 实测）

| 项 | 状态 | 说明 |
|---|---|---|
| LICENSE | ✅ 已补 | 专有许可：授权使用/内部部署，禁公开传播与再许可 |
| `.env` 忽略 | ✅ 已补 | 之前靠"碰巧没 add"，现在靠规则 |
| 敏感文件追踪 | ✅ 无 | `git ls-files` 无 .env/.pem/.key/secret |
| 仓库可见性 | ⚠️ **仍需你去改** | 现在是 **public**，见下方动作 1 |

---

## 动作 1（必做，只有你能做）：转私有

仓库 `janxland/wordEditor` 当前是 **public + 无 license**，这意味着在 LICENSE 补上之前，
任何人都能 clone 你要卖的全部东西：10 个模板、spec.yaml DSL、模板工厂、双引擎管线。

**操作**：仓库页 → Settings → General → Danger Zone → Change visibility → Private

转私有后如果仍想让别人试用，两个正规出口：
- **对内**：把打包好的 Electron 安装包 / 二进制发给他们（源码不出仓库）
- **对外售卖**：签署授权协议后单独交付（LICENSE §6）

## 动作 2：补仓库元数据

在 Settings → General 填：

- **Description**：
  `Markdown→docx 论文排版引擎：模板反向工厂 + 单一 CLI/MCP 入口，支持任意学校格式规范自助接入`
- **Topics**：`docx`、`pandoc`、`mcp-server`、`thesis-formatting`、`ooxml`、`markdown`
- **Homepage**：你的站点

## 动作 3：确认没有"半公开"的镜像

代码可能被这些渠道泄漏，逐个自查：
- [ ] 公开的 gist / 博客里贴过 `mcp_server.py` 或 `clone_core.py` 全文
- [ ] 之前部署的云服务器目录里存着仓库副本（检查 `/www/wwwroot/word.roginx.ink/repo/` 权限）
- [ ] npm / PyPI 上有同名包（当前无，若发布务必配 `LICENSE` 与 `private: false` 的一致性）
- [ ] 别人 fork 过（当前 forks=0，转私有后即冻结）

## 动作 4：商业授权的两条路（选一条，别混）

|模式 | 做法 | 适合 |
|---|---|---|
| **纯闭源授权**（当前 LICENSE） | 源码只在私有仓库，交付安装包 + 授权码 | 你要按学校/按团队卖，代码是核心资产 |
| **开源内核 + 闭源服务** | 内核（CLI/MCP/spec DSL）走 AGPL 公开，模板工厂与云端服务闭源 | 你要抢生态位、让内核被各处嵌入，靠模板市场和服务变现 |

⚠️ **别做成"公开仓库 + 无 license"**。那是 GitHub 上最危险的组合：法律上你保留一切权利，
但**事实上任何人都能拿走它去做竞品**，你连索赔的依据都没有（无 license = 未授权使用，
举证责任在你）。要么明确授权（AGPL + 商业双轨），要么锁死（私有 + 专有 license）。

## 动作 5：真正该防的不是代码，是模板生态

代码能被读走，这一点无法阻止（也不必阻止——被读说明有人感兴趣）。
**防不住的是数据资产**，所以：

1. **模板市场化**：模板做成云端索引（学校/学院/文种），而不是仓库里的静态文件。
   50 个学校贡献的模板，别人 fork 也追不上。
2. **复刻能力收口**：`clone_template` 走工厂全链路 + 机械验收（0 FAIL 才算成功），
   这套"自动探测边界 + 逐段实测 + 格式验收"的组合是核心 know-how，
   它在**闭源仓库**里，公开仓库只剩调用入口。
3. **verify 即卖点**：每次构建出逐段格式 diff 证据，PaperRed 那种黑盒只给清单。

---

## 已固化的技术护栏（代码层，别绕过）

- **封面 / 尾页评分表整页字节级搬运**，不复刻不分析（`tpl_factory/slices.py`）
- **不解析后重写块内容**：lxml parse→serialize 会丢 `proofErr`/注释/PI 并破坏 ns 前缀绑定，
  块走字节切割 + 字符串注入
- **文档级默认值同源**：`reference.docx` 整包克隆源 docx，不从零构造
  （从零造会把 `pPrDefault` / `themeFontLang` 冲成错值，封面与编号会集体走形）
- **0 FAIL 才结案**：`template_verify.py` 逐项比对（页面/封面块/尾表/正文/标题/编号），
  任一 FAIL 退出码非 0，`we clone` 与 `clone_template` 都据此返回 `ok: false`

这些不是过度设计，是**踩过两次坑换来的**。改动 `tpl_factory/` 前先读
`templates/hutb-shehui-diaocha/spec.yaml` 顶头的铁律注释。
