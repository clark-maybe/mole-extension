/**
 * 站点工作流 & 动态工具 & 调试 Channel 处理器
 * 从 background.ts 提取
 */
import Channel from '../lib/channel';
import {
    importDynamicToolsFromManifest,
    listDynamicTools,
    mcpClient,
    removeDynamicTool,
    upsertDynamicTool,
} from '../functions/registry';
import {
    executeDebugRemotePlan,
    getSupportedRemotePlanActions,
} from '../functions/remote-workflow';
import { listSiteWorkflows, reloadRegistryFromStore } from '../functions/site-workflow-registry';
import { matchWorkflows } from '../functions/site-workflow-matcher';
import { listAllSkills } from '../functions/skill-registry';
import { matchSkills } from '../functions/skill-matcher';

// ============ 站点工作流匹配（供 content script 查询当前页面可用的 workflow） ============

Channel.on('__site_workflows_match', (data, _sender, sendResponse) => {
    void (async () => {
        const url = String(data?.url || '').trim();

        // 优先从新 Skill 注册表查询
        const allSkills = await listAllSkills();
        const matched = matchSkills(url, allSkills);
        // 域级 Skill 的 workflow 展示为卡片提示（全局 Skill 不展示，避免卡片过多）
        const domainSkills = matched.filter(s => s.scope === 'domain');
        const workflows = domainSkills.flatMap(s =>
            s.workflows.map(w => ({
                name: w.name,
                label: w.label,
                description: w.description,
                skillLabel: s.label,
                hasRequiredParams: Array.isArray(w.parameters?.required) && w.parameters.required.length > 0,
            }))
        );

        if (workflows.length > 0) {
            // 按 label 去重
            const seenLabels = new Set<string>();
            const deduped = workflows.filter(w => {
                if (seenLabels.has(w.label)) return false;
                seenLabels.add(w.label);
                return true;
            });
            sendResponse?.({ success: true, workflows: deduped });
            return;
        }

        // 回退：从旧 site-workflow 注册表查询（兼容）
        const allWorkflows = await listSiteWorkflows();
        const matchedOld = matchWorkflows(url, allWorkflows);
        const isUniversal = (p: string) => /^\*:\/\/\*\/\*$/.test(p.trim());
        const hinted = matchedOld.filter(w => !w.url_patterns.every(isUniversal));
        const seenLabels = new Set<string>();
        const deduped = hinted.filter(w => {
            if (seenLabels.has(w.label)) return false;
            seenLabels.add(w.label);
            return true;
        });
        sendResponse?.({
            success: true,
            workflows: deduped.map(w => ({
                name: w.name,
                label: w.label,
                description: w.description,
                hasRequiredParams: Array.isArray(w.parameters?.required) && w.parameters.required.length > 0,
            })),
        });
    })().catch(() => {
        sendResponse?.({ success: false, workflows: [] });
    });
    return true;
});

// ============ 动态工具管理 ============

Channel.on('__dynamic_tools_list', (_data, _sender, sendResponse) => {
    void (async () => {
        const tools = await listDynamicTools();
        sendResponse?.({
            success: true,
            tools,
        });
    })().catch((err: unknown) => {
        sendResponse?.({
            success: false,
            message: err instanceof Error ? err.message : '读取动态工具失败',
        });
    });
    return true;
});

Channel.on('__dynamic_tools_upsert', (data, _sender, sendResponse) => {
    void (async () => {
        const rawSpec = data?.spec && typeof data.spec === 'object'
            ? data.spec
            : data;
        const result = await upsertDynamicTool(rawSpec);
        sendResponse?.(result);
    })().catch((err: unknown) => {
        sendResponse?.({
            success: false,
            message: err instanceof Error ? err.message : '更新动态工具失败',
        });
    });
    return true;
});

Channel.on('__dynamic_tools_remove', (data, _sender, sendResponse) => {
    void (async () => {
        const result = await removeDynamicTool(data?.name);
        sendResponse?.(result);
    })().catch((err: unknown) => {
        sendResponse?.({
            success: false,
            message: err instanceof Error ? err.message : '移除动态工具失败',
        });
    });
    return true;
});

Channel.on('__dynamic_tools_import_manifest', (data, _sender, sendResponse) => {
    void (async () => {
        const result = await importDynamicToolsFromManifest(data?.url, data?.replaceAll === true);
        sendResponse?.(result);
    })().catch((err: unknown) => {
        sendResponse?.({
            success: false,
            message: err instanceof Error ? err.message : '导入动态工具失败',
            imported: 0,
            removed: 0,
            skipped: 0,
        });
    });
    return true;
});

// Workflow 注册表热重载（Options 页面修改后通知刷新内存缓存）
Channel.on('__workflow_registry_invalidate', (_data, _sender, sendResponse) => {
    void (async () => {
        await reloadRegistryFromStore();
        sendResponse?.({ success: true });
    })().catch((err: unknown) => {
        sendResponse?.({
            success: false,
            message: err instanceof Error ? err.message : '刷新 workflow 缓存失败',
        });
    });
    return true;
});

// ============ 调试工具 ============

Channel.on('__debug_tools_catalog', (_data, _sender, sendResponse) => {
    void (async () => {
        const tools = await mcpClient.listTools();
        sendResponse?.({
            success: true,
            tools,
            now: Date.now(),
        });
    })().catch((err: unknown) => {
        sendResponse?.({
            success: false,
            message: err instanceof Error ? err.message : '读取调试工具目录失败',
        });
    });
    return true;
});

Channel.on('__debug_call_tool', (data, _sender, sendResponse) => {
    void (async () => {
        const toolName = String(data?.name || '').trim();
        if (!toolName) {
            sendResponse?.({
                success: false,
                message: '缺少工具名',
            });
            return;
        }
        const args = data?.args && typeof data.args === 'object' && !Array.isArray(data.args)
            ? data.args
            : {};
        const tabIdRaw = Number(data?.tabId);
        const tabId = Number.isFinite(tabIdRaw) ? Math.floor(tabIdRaw) : undefined;
        const startedAt = Date.now();
        const mcpResult = await mcpClient.callTool(toolName, args, tabId ? { tabId } : undefined);
        const text = mcpResult?.content?.[0]?.text || '';
        let parsed: unknown = null;
        if (text) {
            try {
                parsed = JSON.parse(text);
            } catch {
                parsed = null;
            }
        }
        sendResponse?.({
            success: true,
            name: toolName,
            tabId: tabId ?? null,
            durationMs: Date.now() - startedAt,
            raw: text,
            parsed,
            mcpResult,
        });
    })().catch((err: unknown) => {
        sendResponse?.({
            success: false,
            message: err instanceof Error ? err.message : '调试调用失败',
        });
    });
    return true;
});

Channel.on('__debug_run_plan', (data, _sender, sendResponse) => {
    void (async () => {
        const workflow = String(data?.workflow || '').trim();
        const plan = data?.plan;
        const params = data?.params;
        const tabIdRaw = Number(data?.tabId);
        const tabId = Number.isFinite(tabIdRaw) ? Math.floor(tabIdRaw) : undefined;
        const startedAt = Date.now();

        const result = await executeDebugRemotePlan(workflow, plan, params, {
            tabId,
        });
        sendResponse?.({
            success: true,
            workflow: workflow || 'baidu_search',
            tabId: tabId ?? null,
            durationMs: Date.now() - startedAt,
            actions: getSupportedRemotePlanActions(),
            parsed: result,
        });
    })().catch((err: unknown) => {
        sendResponse?.({
            success: false,
            message: err instanceof Error ? err.message : '执行 plan 失败',
        });
    });
    return true;
});
