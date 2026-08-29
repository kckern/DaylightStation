/** Node runtime mechanics for debounced remote progress writes. */
export class ProgressWriteRuntime {
  schedule(delayMs, task) { return setTimeout(task, delayMs); }
  cancel(handle) { clearTimeout(handle); }
  async withDeadline(work, timeoutMs, message) {
    let handle;
    try {
      return await Promise.race([work, new Promise((_, reject) => {
        handle = setTimeout(() => reject(new Error(message)), timeoutMs);
      })]);
    } finally { if (handle) clearTimeout(handle); }
  }
}

export default ProgressWriteRuntime;
