export function createLimiter(concurrency: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];

  const runNext = (): void => {
    active--;
    queue.shift()?.();
  };

  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>(resolve => queue.push(resolve));
    }

    active++;
    try {
      return await task();
    } finally {
      runNext();
    }
  };
}

export async function mapConcurrent<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>,
): Promise<U[]> {
  const limit = createLimiter(concurrency);
  return Promise.all(items.map(item => limit(() => mapper(item))));
}
