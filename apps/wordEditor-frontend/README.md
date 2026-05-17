# WordEditor Frontend

React 可视化管理台：Markdown 导出 Word、编辑模板 DSL / Lua / VBA。

## 架构

```
src/
  platform/          # 功能注册表（可扩展为低代码模块配置）
  kernel/
    pipeline/        # IBuildPipeline — MD→Word 管线抽象
  services/storage/  # IStorageAdapter — 文件读写抽象
  store/             # appStore | editorStore | exportStore
  app/               # Shell + 路由
  pages/             # 各功能页面（按路由懒加载）
server/
  dev-api.ts         # 开发态 REST（生产替换为独立后端）
```

新增功能：在 `platform/registerFeatures.ts` 调用 `registerFeature()`，无需改 Shell。

## 启动

```powershell
cd apps/wordEditor-frontend
pnpm install
pnpm dev
```

依赖：本机 **Python**、**Pandoc**、**Microsoft Word**（完整后处理管线）。

## 页面

| 路由 | 功能 |
|------|------|
| `/export` | 输入 Markdown → 调用 `scripts/build.py` → 下载 docx |
| `/` | 模板 DSL / Lua 可视化编辑 |
| `/vba` | VBA 宏编辑 |
| `/docs` | 规范文档只读 |

## API（开发态 `/api`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/build` | `{ markdown, templateId, options?, fileName? }` |
| GET | `/build/download?jobId=` | 下载 docx |
| GET | `/templates` | templates.json |
| GET/PUT | `/file?path=` | 读写仓库内文本文件 |

构建缓存：`.cache/wordeditor-ui/<jobId>/`
