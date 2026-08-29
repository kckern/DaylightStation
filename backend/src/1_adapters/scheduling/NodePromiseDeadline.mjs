/** Node timer-backed implementation of the application promise-deadline port. */
export class NodePromiseDeadline {
  async run(work, { timeoutMs, message } = {}) {
    let timer;
    try {
      return await Promise.race([
        work,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export default NodePromiseDeadline;
