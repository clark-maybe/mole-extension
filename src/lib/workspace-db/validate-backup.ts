/** 导入前检查记录形状和引用；不接受可执行的旧指令。 */
import type { WorkspaceBackup } from '../../workspace/types';
import { STORE_NAMES } from './database';

export function validateBackup(backup: WorkspaceBackup): void {
  if (backup.format !== 'mole-workspace' || backup.version !== 1 || !backup.records || typeof backup.records !== 'object') throw new Error('备份格式无效');
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  let count = 0;
  for (const name of STORE_NAMES) {
    const rows = backup.records[name];
    if (!Array.isArray(rows)) throw new Error(`备份缺少 ${name}`);
    const table = new Map<string, Record<string, unknown>>();
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`无效 ${name} 记录`);
      const row = raw as Record<string, unknown>;
      const key = name === 'events' ? row.eventId : row.id;
      if (typeof key !== 'string' || !key || table.has(key)) throw new Error(`重复或无效 ${name} 标识`);
      table.set(key, row);
      if (++count > 500_000) throw new Error('备份超过单次导入容量');
    }
    tables.set(name, table);
  }
  const has = (table: string, id: unknown) => typeof id === 'string' && tables.get(table)?.has(id);
  const require = (table: string, id: unknown) => { if (!has(table, id)) throw new Error(`备份引用不存在：${table}`); };
  for (const row of tables.get('sessions')!.values()) {
    if (!row.snapshot || typeof row.snapshot !== 'object' || (row.snapshot as { id?: unknown }).id !== row.id) throw new Error('会话快照无效');
  }
  for (const name of ['events', 'tasks']) for (const row of tables.get(name)!.values()) require('sessions', row.sessionId);
  for (const name of ['steps', 'evidence', 'taskLeads', 'facts', 'assessments', 'deliveries']) {
    for (const row of tables.get(name)!.values()) require('tasks', row.taskId);
  }
  for (const name of ['taskLeads', 'facts', 'assessments', 'deliveries']) {
    for (const row of tables.get(name)!.values()) require('leads', row.leadId);
  }
  for (const row of tables.get('facts')!.values()) {
    require('evidence', row.evidenceId);
    if (tables.get('evidence')!.get(row.evidenceId as string)!.taskId !== row.taskId) throw new Error('字段事实的任务与证据不一致');
  }
  const stepKeys = new Set([...tables.get('steps')!.values()].map(step => JSON.stringify([step.taskId, step.stepId || step.id])));
  for (const row of tables.get('evidence')!.values()) {
    if (!stepKeys.has(JSON.stringify([row.taskId, row.stepId]))) throw new Error('证据步骤引用不存在');
  }
  for (const row of tables.get('steps')!.values()) {
    if (!Array.isArray(row.evidenceIds)) throw new Error('步骤证据无效');
    for (const id of row.evidenceIds) {
      require('evidence', id);
      if (tables.get('evidence')!.get(id)!.taskId !== row.taskId) throw new Error('步骤证据不属于同一任务');
    }
  }
  const sourceKeys = new Set();
  for (const row of tables.get('leads')!.values()) {
    if (sourceKeys.has(row.sourceKey)) throw new Error('线索来源标识重复');
    sourceKeys.add(row.sourceKey);
  }
  for (const row of tables.get('commands')!.values()) {
    const command = row.command as Record<string, unknown> | undefined;
    if (!command || typeof command.sessionId !== 'string' || command.requestId !== row.id) throw new Error('指令记录无效');
    // 尚未处理的新会话指令允许目标档案尚不存在，导入后不自动执行。
  }
  for (const row of tables.get('entityLinks')!.values()) {
    require('leads', row.sourceLeadId); require('leads', row.companyLeadId);
    if (!Array.isArray(row.evidenceIds)) throw new Error('主体关联证据无效');
    for (const id of row.evidenceIds) require('evidence', id);
  }
  for (const row of tables.get('leads')!.values()) {
    if (!Array.isArray(row.evidenceIds) || typeof row.sourceKey !== 'string') throw new Error('线索来源无效');
    for (const id of row.evidenceIds) require('evidence', id);
    if (row.companyId) require('leads', row.companyId);
  }
  for (const row of tables.get('assessments')!.values()) {
    if (!Array.isArray(row.factIds) || !Array.isArray(row.evidenceIds)) throw new Error('判断引用无效');
    for (const id of row.factIds) {
      require('facts', id);
      if (tables.get('facts')!.get(id)!.leadId !== row.leadId) throw new Error('判断事实不属于同一线索');
    }
    for (const id of row.evidenceIds) require('evidence', id);
  }
}
