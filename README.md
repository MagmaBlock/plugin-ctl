# plugin-ctl

`plugin-ctl` 是一个面向 **Minecraft Paper/Spigot 服务端**的命令行工具，用来统一管理多个服务器目录下的插件 `jar`。

它的目标不是“手工把 jar 拖来拖去”，而是把插件管理变成可审计、可复现、可批量执行的流程。

## 这个工具解决什么问题

- 一个项目里有多个服务器（如 `lobby`、`survival`），插件版本难以统一
- 升级插件时容易忘记来源、忘记回滚点
- 团队协作时，别人很难知道“这个服务器现在到底应该装哪些插件”

`plugin-ctl` 用 **YAML 清单 + 锁文件**把这些问题固定下来。

## 核心概念（先看这个）

- `工作区（workspace）`
当前目录初始化后，会生成一套管理文件，后续所有命令都基于这套文件工作。

- `服务器配置（Server Profile）`
每个服务器一份 `servers/<server-id>.yaml`，定义服务器路径、MC 版本、服务端类型（paper/spigot）和“期望安装的插件列表”。

- `插件目录（Catalog）`
`.pluginctl/catalog.yaml` 是“插件来源登记簿”。
先把插件来源登记进目录，再在某个服务器里引用它。

- `期望状态（Desired State）`
服务器配置里写的是“我希望这个服务器安装哪些插件、按什么策略选版本”。

- `锁文件（Lock）`
`.pluginctl/lock/<server-id>.lock.yaml` 记录“上次实际安装的是哪个版本、下载地址、校验值”。
它保证重复执行时结果可复现。

- `计划（Plan）`
变更前先计算差异：哪些会新增、升级、降级、删除。
你确认后才会真正写入服务器插件目录。

- `本地待处理队列（Pending Queue）`
每个服务端目录下会维护 `<serverRoot>/.pluginctl/pending.yaml`，用于记录“待删除”操作。
这让跨机器、跨系统时能在“合适时机”再执行删除。

- `缓存与回收站`
下载文件会放在 `.pluginctl/cache/`，被替换/删除的插件会进 `.pluginctl/trash/`（默认每个插件保留最近 3 份）。

## 支持的插件来源（v1）

- `modrinth`
- `hangar`
- `github`
- `manual`（本地文件或 URL 手动来源）

说明：v1 暂不包含 SpigotMC 自动接入。

## 安装

```bash
npm install
npm run build
npm link
```

验证：

```bash
plugin-ctl --help
```

## 第一次使用（推荐按顺序）

### 1) 初始化工作区

```bash
plugin-ctl init
```

初始化后会创建/使用这些文件：

- `pluginctl.yaml`
- `servers/<server-id>.yaml`
- `.pluginctl/catalog.yaml`
- `.pluginctl/lock/<server-id>.lock.yaml`
- `.pluginctl/cache/`
- `.pluginctl/trash/`
- `.pluginctl/plans/`

### 2) 添加一个服务器

```bash
plugin-ctl server add lobby --path /srv/mc/lobby --mc 1.21.4 --flavor paper
```

### 3) 搜索插件来源

```bash
plugin-ctl source search luckperms
```

默认只搜索 `modrinth,hangar`，并只展示前 10 条（已覆盖绝大多数插件场景）；输出按来源分组、按相关性排序。你也可以手动控制：

```bash
plugin-ctl source search viaversion --limit 8
plugin-ctl source search viaversion --from modrinth,hangar,github
plugin-ctl source search viaversion --all
plugin-ctl source search viaversion --compact
```

### 4) 把插件登记进 Catalog

```bash
plugin-ctl catalog add modrinth:luckperms
```

### 5) 把插件加到服务器并执行

```bash
plugin-ctl plugin add lobby modrinth:luckperms
```

命令会先显示变更计划，再让你确认。确认后会下载并写入 `plugins/update/`（重启后生效）。

## 日常操作示例

### 查看当前配置

```bash
plugin-ctl server list
plugin-ctl catalog list
```

### 升级插件

升级单个：

```bash
plugin-ctl plugin upgrade lobby modrinth:luckperms
```

升级全部：

```bash
plugin-ctl plugin upgrade lobby --all
```

### 删除插件

```bash
plugin-ctl plugin remove lobby modrinth:luckperms
```

说明：删除会先写入服务端本地 pending 队列，不会强制在线删除被锁文件。

### 按清单对齐（修复漂移）

```bash
plugin-ctl plugin sync lobby
```

### 只生成计划，不立即执行

```bash
plugin-ctl plan lobby
```

或对全部服务器：

```bash
plugin-ctl plan --all-servers
```

### 应用已保存计划

```bash
plugin-ctl apply .pluginctl/plans/<your-plan>.yaml
```

### 健康检查

```bash
plugin-ctl doctor
```

### 执行本地待删除队列（建议在停服时执行）

```bash
plugin-ctl maintenance reconcile lobby
plugin-ctl maintenance reconcile --all-servers
```

## 常用命令总览

- `plugin-ctl source search <keyword> [--from modrinth,hangar,github,manual] [--limit <n>|--all] [--compact]`（默认来源：`modrinth,hangar`）
- `plugin-ctl catalog add <source-ref> [--alias <name>]`
- `plugin-ctl catalog list`
- `plugin-ctl server list`
- `plugin-ctl server add <server-id> --path <dir> --mc <version> --flavor <paper|spigot>`
- `plugin-ctl plugin add <server-id> <plugin-id> [--version <ver>]`
- `plugin-ctl plugin remove <server-id> <plugin-id>`
- `plugin-ctl plugin upgrade <server-id> <plugin-id|--all>`
- `plugin-ctl plugin sync <server-id>`
- `plugin-ctl plan <server-id> [--all-servers]`
- `plugin-ctl apply <plan-file>`
- `plugin-ctl doctor`
- `plugin-ctl maintenance reconcile <server-id|--all-servers>`

## 版本与安全策略

- 默认只选稳定版（stable），不自动选预发布
- 如果来源提供 `sha256`，安装时会强校验
- 如果来源不提供 `sha256`，会继续安装但输出警告
- add/upgrade 默认会将新 jar staged 到 `plugins/update/`，重启后生效
- remove 默认入队到 `<serverRoot>/.pluginctl/pending.yaml`，由 `maintenance reconcile` 在合适时机执行删除
- 所有写入采用临时文件 + 原子替换，避免半写入

## 你可以这样理解整体流程

1. 在 Catalog 里登记“插件从哪来”
2. 在 Server Profile 里声明“服务器要装哪些插件”
3. 生成/查看 Plan
4. 确认后 Apply
5. 用 Lock 文件固定结果，保证下次可复现

如果你刚开始用，最小可跑通路径是：`init -> server add -> source search -> catalog add -> plugin add`。
