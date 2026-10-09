export type FaultMode = 'NONE' | 'CRASH' | 'PARTITION';

export class FaultManager {
  private mode: FaultMode = 'NONE';

  public setMode(mode: FaultMode): void {
    this.mode = mode;
  }

  public getMode(): FaultMode {
    return this.mode;
  }

  public isCrashed(): boolean {
    return this.mode === 'CRASH';
  }

  public isPartitioned(): boolean {
    return this.mode === 'PARTITION' || this.mode === 'CRASH';
  }
}
