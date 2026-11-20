/** IndexedDB 薄封装：只等待数据库请求，不在事务内执行网络或模型调用。 */
import { WorkspacePersistenceError } from '../../workspace/errors';
export const DATABASE_NAME = 'mole_workspace';
export const DATABASE_VERSION = 1;
export const STORE_NAMES = ['sessions', 'events', 'tasks', 'steps', 'evidence', 'leads', 'taskLeads', 'facts', 'assessments', 'entityLinks', 'deliveries', 'commands', 'meta'] as const;
export type StoreName = typeof STORE_NAMES[number];

export function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error || new Error('数据库请求失败'));
  });
}

export class WorkspaceDatabase {
  private connection?: Promise<IDBDatabase>;
  private readonly name: string;
  private readonly factory?: IDBFactory;
  constructor(name = DATABASE_NAME, factory?: IDBFactory) { this.name = name; this.factory = factory; }

  open(): Promise<IDBDatabase> {
    if (!this.factory && !globalThis.indexedDB) return Promise.reject(new Error('当前环境不支持 IndexedDB'));
    if (!this.connection) {
      this.connection = new Promise((resolve, reject) => {
        const factory = this.factory || globalThis.indexedDB;
        if (!factory) { reject(new Error('当前环境不支持 IndexedDB')); return; }
        const opening = factory.open(this.name, DATABASE_VERSION);
        opening.onupgradeneeded = () => {
          const db = opening.result;
          for (const name of STORE_NAMES) {
            const store = db.createObjectStore(name, name === 'events'
              ? { keyPath: 'seq', autoIncrement: true } : { keyPath: 'id' });
            if (name === 'events') {
              store.createIndex('sessionSeq', ['sessionId', 'seq']);
              store.createIndex('eventId', 'eventId', { unique: true });
            }
            if (name === 'sessions') store.createIndex('updatedAt', 'updatedAt');
            if (name === 'leads') store.createIndex('sourceKey', 'sourceKey', { unique: true });
            if (name === 'taskLeads') store.createIndex('taskId', 'taskId');
            if (name === 'entityLinks') { store.createIndex('sourceLeadId', 'sourceLeadId'); store.createIndex('companyLeadId', 'companyLeadId'); }
            if (name === 'tasks') store.createIndex('sessionId', 'sessionId');
            if (['facts', 'assessments', 'deliveries'].includes(name)) store.createIndex('leadId', 'leadId');
            if (['steps', 'evidence', 'deliveries'].includes(name)) store.createIndex('taskId', 'taskId');
          }
        };
        opening.onsuccess = () => {
          const db = opening.result;
          db.onversionchange = () => { db.close(); this.connection = undefined; };
          resolve(db);
        };
        opening.onerror = () => { this.connection = undefined; reject(opening.error); };
        opening.onblocked = () => { this.connection = undefined; reject(new Error('数据库升级受阻，请关闭其他 Mole 页面后重试')); };
      });
    }
    return this.connection;
  }

  async transaction<T>(stores: readonly StoreName[], mode: IDBTransactionMode, body: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = await this.open();
    const tx = db.transaction([...stores], mode);
    const completed = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('数据库事务已回滚'));
      tx.onerror = () => { /* abort 统一报告错误 */ };
    });
    // body 抛错时也观察事务失败，避免产生未处理拒绝。
    void completed.catch(() => undefined);
    try {
      const value = await body(tx);
      await completed;
      return value;
    } catch (error) {
      try { tx.abort(); } catch { /* 已结束的事务无需再次回滚 */ }
      await completed.catch(() => undefined);
      if (error instanceof DOMException) throw new WorkspacePersistenceError(`本地数据库写入失败：${error.message}`);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.connection) (await this.connection).close();
    this.connection = undefined;
  }
}

/** 有界游标读取，避免列表页一次拉取所有历史和证据。 */
export function cursorPage<T>(source: IDBObjectStore | IDBIndex, range: IDBKeyRange | undefined, limit: number, direction: IDBCursorDirection = 'next', offset = 0, accept?: (row: T) => boolean): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const rows: T[] = [];
    const operation = source.openCursor(range, direction);
    operation.onerror = () => reject(operation.error);
    operation.onsuccess = () => {
      const cursor = operation.result;
      if (!cursor || rows.length >= limit) { resolve(rows); return; }
      if (accept && !accept(cursor.value as T)) { cursor.continue(); return; }
      if (offset > 0) { const skip = accept ? 1 : offset; offset -= skip; cursor.advance(skip); return; }
      rows.push(cursor.value as T);
      cursor.continue();
    };
  });
}
