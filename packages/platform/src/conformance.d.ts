export function defineFsConformance(
  t: { describe: Function; it: Function; beforeEach: Function; afterEach: Function },
  name: string,
  make: () => Promise<{ fs: object; root: string; cleanup?: () => Promise<void> }>,
): void;
