/** 本地持久化失败必须停止依赖该记录的执行，不能作为普通平台错误重试。 */
export class WorkspacePersistenceError extends Error {}
