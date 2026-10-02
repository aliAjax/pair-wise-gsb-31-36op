import type { ConflictDetail } from '@/models/commitBatch';

/** 乐观锁校验失败（页面落后）抛出的错误，保留完整冲突详情供页面渲染 */
export class CommitConflictError extends Error {
  conflicts: ConflictDetail[];

  constructor(conflicts: ConflictDetail[]) {
    super('数据已被其他页面修改，请基于最新内容重试');
    this.name = 'CommitConflictError';
    this.conflicts = conflicts;
  }
}

export const isCommitConflictError = (error: unknown): error is CommitConflictError =>
  error instanceof CommitConflictError;
