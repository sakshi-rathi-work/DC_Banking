export interface RpcTraceEntry {
  method: string;
  fromNode: number;
  toNode: number;
  lamportSend: number;
  lamportRecv: number;
  latencyMs: number;
  requestId: string;
  physicalTs: string;
}

export class RpcTraceBuffer {
  private capacity: number;
  private buffer: RpcTraceEntry[];
  private head: number = 0;
  private size: number = 0;

  constructor(capacity = 500) {
    this.capacity = capacity;
    this.buffer = new Array<RpcTraceEntry>(capacity);
  }

  public addTrace(entry: RpcTraceEntry): void {
    this.buffer[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  public getTraces(limit?: number, requestId?: string): RpcTraceEntry[] {
    const traces: RpcTraceEntry[] = [];
    const count = this.size;

    for (let i = 0; i < count; i++) {
      const idx = (this.head - 1 - i + this.capacity) % this.capacity;
      const item = this.buffer[idx];
      if (item) {
        if (!requestId || item.requestId === requestId) {
          traces.push(item);
          if (limit && traces.length >= limit) {
            break;
          }
        }
      }
    }

    return traces;
  }

  public clear(): void {
    this.head = 0;
    this.size = 0;
    this.buffer = new Array<RpcTraceEntry>(this.capacity);
  }
}
