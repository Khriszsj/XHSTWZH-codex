declare module "better-sqlite3" {
  interface Statement<BindParameters extends unknown[] = unknown[], Result = unknown> {
    run(...params: BindParameters): unknown;
    get(...params: BindParameters): Result;
    all(...params: BindParameters): Result[];
  }

  interface Database {
    pragma(statement: string): unknown;
    exec(sql: string): this;
    prepare<Result = unknown>(sql: string): Statement<unknown[], Result>;
    transaction<T extends (...args: any[]) => any>(fn: T): T;
  }

  interface DatabaseConstructor {
    new (filename: string): Database;
  }

  const Database: DatabaseConstructor;
  export default Database;
}
