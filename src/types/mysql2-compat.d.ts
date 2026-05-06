declare module "mysql2" {
  export type ResultSetHeader = {
    affectedRows: number;
    changedRows: number;
    insertId: number;
    rowCount: number;
  };
  export type RowDataPacket = Record<string, unknown>;
}

declare module "mysql2/promise" {
  export type ResultSetHeader = {
    affectedRows: number;
    changedRows: number;
    insertId: number;
    rowCount: number;
  };
  export type RowDataPacket = Record<string, unknown>;
  export type PoolConnection = {
    query<T = unknown>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
    execute<T = unknown>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
    beginTransaction(): Promise<unknown>;
    commit(): Promise<unknown>;
    rollback(): Promise<unknown>;
    release(): void;
  };
}
