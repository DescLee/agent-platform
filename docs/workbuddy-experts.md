# WorkBuddy 专家导入

在“设置 → 协作助手 → 导入协作助手”中选择 GitHub 目录链接、本地文件夹或 ZIP。
目录须为单个专家的根目录，包含 `.codebuddy-plugin/plugin.json` 以及其声明的角色和技能文件。
不要选择整个 `workbuddyskills` 仓库或 `experts` 合集目录。

本次内部 AICoding 大赛演示导入了四个专家：

| 专家 | GitHub 导入链接 | 适合测试的任务 |
| --- | --- | --- |
| 会议纪要提取专家 | https://github.com/infometa/workbuddyskills/tree/main/experts/ai-meeting-notes | 提供一段会议记录，提取决策、负责人和待办 |
| 代码审查专家 | https://github.com/infometa/workbuddyskills/tree/main/experts/code-review-expert | 选择测试项目，审查当前改动并输出问题清单 |
| 自媒体内容写作专家 | https://github.com/infometa/workbuddyskills/tree/main/experts/content-writer | 为内部 AICoding 大赛起草宣传稿 |
| 产品通（产品管理专家） | https://github.com/infometa/workbuddyskills/tree/main/experts/product-management | 为比赛报名系统起草 PRD 和验收标准 |

本次源版本：`78170571d08e7d38c6baf0a13ef805487bfa6dc2`。上面的链接跟随 `main`，以后内容可能变化。

## 转换行为

- 读取中文名称、描述、角色正文、快捷任务和随包技能，生成 `wb-` 前缀的本地协作助手。
- 通用专家获得文件、搜索、待办能力；工程分类额外获得本地 Git 读取能力，并要求选择项目文件夹。
- 新导入的助手默认停用，界面展示能力及兼容说明，启用后进入新会话选择器。
- 快捷任务先填入输入框，方便补充比赛素材后再发送。
- 保留原始角色、配置及包内权利声明；导出为本应用的 ZIP 后可以再次导入。

## 支持边界

目前只支持单专家包。团队、多 Agent 和依赖 Hooks 的包会拒绝导入，安装时不执行脚本。
原平台的自动运行、工具授权、最大轮数、连接器、MCP、规则和命令配置不会自动生效。
文件读写仍遵循本应用的审批流程；导入不会开启 Shell、定时任务或外部服务账户。

技能正文可能提到未提供的 CLI、API 或平台工具，这些依赖不会自动安装。
例如代码审查专家可以审查本地项目，但随附 GitHub 技能依赖 `gh`，本次没有授予该执行能力。
PPT、图片生成、团队协作等依赖原平台能力的专家，需要另行适配，不能据此宣称全部专家兼容。

## 本机演示包

当前四个助手已导入本机应用数据目录，启用且保留“操作前询问”。
`build/workbuddy-demo/` 中生成了四个可再次导入的 ZIP，附带上游来源和权利声明；该目录不纳入 Git。
这些是第三方内容，导入并不意味着取得新的分发授权。对外分发前须核对上游及各专家的许可。
