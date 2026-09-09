# 验收与联调清单（ACCEPTANCE）

本文件记录 dsh-preset-composer 的构建产物、已完成的验证，以及仍需在 patched
DSH checkout 上完成的联调项。区分「已核验（真实工具输出）」与「待联调（需等价
于 DSH 内置 clientBundle 的产物）」。

## 已核验（真实输出）

| 项 | 结果 |
|---|---|
| 插件纯逻辑单测 | `pnpm test` → `tests/presets.spec.ts` 22/22 通过 |
| `presets.ts` / `types.ts` 类型检查 | `tsc --noEmit` exit 0（`allowImportingTsExtensions`） |
| Host 半构建 | `pnpm bundle` → `lib/index.mjs`（+`lib/index.d.mts`）构建成功 |
| Host 产物运行时 import | 仅 `node:` 内建 + `@deepseek-ai/schemastery`；`js-yaml` 已内联；其余 `@deepseek-ai/*` 为 `import type` 已消除 |
| `cordis.patch.yml` | 解析为合法的 patch 列表，单行 `{id: preset-composer, name: dsh-preset-composer}` |
| DSH 核心 3 处改动 | 已回读验证（子槽声明 / children 注册 / renderSlot） |

## 单测覆盖（presets.spec.ts）

- `!!js` 表达式解析为 `{ __jsExpr }`，且 `dump → parse` 往返不变（关键方言）。
- `!!js` gated 行视为 enabled。
- `reconcile`：启用=删除 `disabled`；停用=`disabled:true`；保留未变动行的原始值；
  persona prefix 改写；skill-filesystem `customSkillDirs` 指向 `<preset>/skills`；
  删除未列出插件、追加新插件；重建缺失的结构行（persona 前置于队首）；原样保留
  未知条目（如 `group`/`isolate` 结构）。
- skill frontmatter：解析 name/description/enabled；`disable-model-invocation:true`
  视为停用；切换只改 frontmatter、正文逐字节保留；无 frontmatter 不改动。

## 待联调（需 patched DSH checkout）

### 1. DSH 核心改动落地
- 提交并合并/应用 `packages/client/ui-agent-preset` 的 3 处改动（子槽）；
  重建 DSH web artifact（`pnpm run build`，子槽需在 web 装配中渲染）。

### 2. Client 半构建
浏览器侧 `lib/client.js` 必须由 DSH 的 `clientBundle` 产物（closure-factory over
module table）生成——独立 tsdown 无法复刻该格式。步骤见 README「Produce the
client bundle」：将插件拷入 `packages/client/`，以 `clientBundle('dsh-preset-composer',
['lib/types/index.js'])` 构建，拷贝 `lib/` 回本 checkout。
- 复刻后核验 `lib/client.js` 首行是 `window.__ModuleLoader__.load(...)` 工厂形态，
  并在 `dsh.client.inject` 记录的 peer 上 externalize。

### 3. 对 patched checkout 编译型检查
`src/index.ts` 与 `src/client/*` 依赖 patched checkout 里的
`@deepseek-ai/schemastery` / `dsh-settings` / `dsh-agent-presets` /
`dsh-client-ui-*` 类型。以 `file:`/`link:` 解析到本地 patch 后的 DSH 后，运行：
- Host：`tsc -p tsconfig.json --noEmit`（或 `pnpm bundle`）。
- Client：通过 DSH `clientBundle` 构建（同上）。

### 4. 端到端人工验收
1. `dsh plugin --profile web add ./dsh-preset-composer` 后重启 profile。
2. Settings → Agent 预设 → 自定义预设卡片上出现「⚙ 配置」按钮（在「打开目录」左侧）。
3. 打开配置：改名称/描述/预设提示词，切换 skill 启用，增删/启停插件，保存。
4. 检查磁盘：`preset.yml` name/description 更新且 `order` 保留；
   `agent.cordis.yml` persona `config.prefix` 更新、`!!js` 表达式行未被动、
   结构行（persona/skill-filesystem/tool-skill）幂等存在；
   `skills/<name>/SKILL.md` 的 `disable-model-invocation` 正确切换、正文未损。
5. 新建一个自定义预设 → 需重启后再配置（v1 限制，弹窗提示）。

## 已知限制（v1）

- 启动后新建的预设不会进命名空间镜像，需要重启才可配置。
- `!!js` 平台 gated 行（如 tool-bash/tool-pwsh）在主动切换前显示为启用。
- 插件仅管理顶层行；嵌套 `group` 子行保留但不在列表展示。
- 新增插件不提供 `id` 编辑（取包名派生）。

## 回滚策略

- DSH 核心 3 处改动：`git checkout -- <file>` 即可还原；子槽缺失时插件
  `ctx.slots.inject` 不会触发，按钮不显示，不影响 dsh 启动。
- 插件卸载：`dsh plugin remove dsh-preset-composer`（等价
  pnpm remove + 从 `dsh.profile.bundles` 移除），重启恢复原状。
- 插件写入的文件均可手动编辑还原（YAML 保持 `!!js` 方言）。
