type Task = () => Promise<void>;

export class TaskQueue {
  private queue: Task[] = [];
  private concurrency: number;
  private running: number = 0;

  constructor(concurrency: number = 2) {
    this.concurrency = concurrency;
  }

  add(task: Task) {
    this.queue.push(task);
    this.processNext();
  }

  private async processNext() {
    if (this.running >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    this.running++;
    try {
      await task();
    } catch (error) {
      console.error('[TaskQueue] Error executing task:', error);
    } finally {
      this.running--;
      this.processNext();
    }
  }
}
