declare module "bun" {
  interface ServerWebSocket<T = undefined> {
    addEventListener(asd: string): void;
  }
}
