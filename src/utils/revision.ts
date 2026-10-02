import type { RemoteChange, RevisionMismatchDetail } from '@/types';

/**
 * 乐观锁冲突：页面提交时携带的修订信息已经落后于存储中的有效版本。
 * 抛出后上层保留用户输入，按 details/changes 提示并引导基于新数据重做。
 */
export class RevisionMismatchError extends Error {
  details: RevisionMismatchDetail[];
  changes: RemoteChange[];

  constructor(message: string, details: RevisionMismatchDetail[], changes: RemoteChange[]) {
    super(message);
    this.name = 'RevisionMismatchError';
    this.details = details;
    this.changes = changes;
  }
}

export const isRevisionMismatchError = (error: unknown): error is RevisionMismatchError =>
  error instanceof RevisionMismatchError;
