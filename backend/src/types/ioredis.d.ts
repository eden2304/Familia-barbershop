declare module 'ioredis' {
  export interface RedisOptions {
    lazyConnect?: boolean;
    maxRetriesPerRequest?: number | null;
    enableReadyCheck?: boolean;
  }

  export default class Redis {
    options: { password?: string };
    constructor(url: string | undefined, options?: RedisOptions);
    ping(): Promise<string>;
    call(...args: string[]): Promise<unknown>;
    quit(): Promise<'OK' | string>;
  }
}
