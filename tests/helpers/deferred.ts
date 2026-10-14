export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason: unknown): void;
}

/** An explicit synchronization point owned and settled by the test. */
export function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/** The rejection reason a promise settles with, or null when it resolves. */
export function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => null, (reason: unknown) => reason);
}
