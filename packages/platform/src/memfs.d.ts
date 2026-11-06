export function createMemFs(opts?: { now?: () => number }): Record<string, (...args: any[]) => Promise<any>> & { constants: Record<string, number> };
