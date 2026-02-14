declare class Redis {
  options: { password?: string };
  constructor(url: string | undefined, options?: {
    lazyConnect?: boolean;
    maxRetriesPerRequest?: number | null;
    enableReadyCheck?: boolean;
  });
  ping(): Promise<string>;
  call(...args: string[]): Promise<unknown>;
  quit(): Promise<'OK' | string>;
}
export default Redis;
