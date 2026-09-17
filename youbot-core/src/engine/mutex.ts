export class Mutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.locked = true;
        resolve(this.release.bind(this));
      });

      if (!this.locked) {
        this.dequeue();
      }
    });
  }

  private dequeue() {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }

  private release() {
    this.dequeue();
  }
}
