declare module 'ioredis' {
  export default class Redis {
    constructor(url: string | undefined, options?: {
      lazyConnect?: boolean;
      maxRetriesPerRequest?: number | null;
      enableReadyCheck?: boolean;
    });
    options: { password?: string };
    ping(): Promise<string>;
    call(...args: string[]): Promise<unknown>;
    quit(): Promise<'OK' | string>;
  }
}
