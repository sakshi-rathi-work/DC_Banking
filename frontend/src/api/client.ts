import type {
  ApiResponse,
  User,
  Account,
  Transaction,
  ClusterOverview,
  NodeStatus,
  ClockState,
  ClockHistoryRound,
  ElectionRecord,
  LoadMetrics,
  SystemEvent,
} from './types';

class ApiClient {
  private baseUrl = '/api';

  private getToken(): string | null {
    return sessionStorage.getItem('dbs_token');
  }

  public setToken(token: string | null): void {
    if (token) {
      sessionStorage.setItem('dbs_token', token);
    } else {
      sessionStorage.removeItem('dbs_token');
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    customIdempotencyKey?: string,
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = new Headers(options.headers || {});

    headers.set('Content-Type', 'application/json');

    const token = this.getToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    if (options.method && ['POST', 'PUT', 'DELETE'].includes(options.method.toUpperCase())) {
      const idempotencyKey = customIdempotencyKey || crypto.randomUUID();
      headers.set('Idempotency-Key', idempotencyKey);
    }

    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (res.status === 401) {
      this.setToken(null);
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }

    const json = (await res.json()) as ApiResponse<T>;

    if (!res.ok || json.success === false) {
      const msg = json.error?.message || `Request failed with status ${res.status}`;
      throw new Error(msg);
    }

    return json;
  }

  // ===== Auth =====
  async register(name: string, email: string, password: string):Promise<ApiResponse<{ user: User; token: string }>> {
    return this.request<{ user: User; token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    });
  }

  async login(email: string, password: string): Promise<ApiResponse<{ user: User; token: string }>> {
    return this.request<{ user: User; token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async getMe(): Promise<ApiResponse<{ user: User }>> {
    return this.request<{ user: User }>('/auth/me');
  }

  // ===== Accounts =====
  async listAccounts(): Promise<ApiResponse<{ accounts: Account[] }>> {
    const res = await this.request<any>('/accounts');
    if (Array.isArray(res.data)) {
      return { ...res, data: { accounts: res.data } };
    }
    return res;
  }

  async createAccount(nickname?: string, initialDepositPaise?: number, idempotencyKey?: string): Promise<ApiResponse<{ account: Account }>> {
    const res = await this.request<any>(
      '/accounts',
      {
        method: 'POST',
        body: JSON.stringify({ nickname, initialDepositPaise }),
      },
      idempotencyKey,
    );
    if (res.data && !res.data.account && res.data.id) {
      return { ...res, data: { account: res.data } };
    }
    return res;
  }

  async getAccount(id: string): Promise<ApiResponse<{ account: Account }>> {
    return this.request<{ account: Account }>(`/accounts/${id}`);
  }

  async lookupAccount(accountNumber: string): Promise<ApiResponse<{ account: { id: string; accountNumber: string; holderMasked: string } }>> {
    return this.request<{ account: { id: string; accountNumber: string; holderMasked: string } }>(
      `/accounts/lookup?accountNumber=${encodeURIComponent(accountNumber)}`,
    );
  }

  // ===== Transactions =====
  async deposit(accountId: string, amountPaise: number, note?: string, idempotencyKey?: string): Promise<ApiResponse<{ transaction: Transaction }>> {
    return this.request<{ transaction: Transaction }>(
      '/transactions/deposit',
      {
        method: 'POST',
        body: JSON.stringify({ accountId, amountPaise, note }),
      },
      idempotencyKey,
    );
  }

  async withdraw(accountId: string, amountPaise: number, note?: string, idempotencyKey?: string): Promise<ApiResponse<{ transaction: Transaction }>> {
    return this.request<{ transaction: Transaction }>(
      '/transactions/withdraw',
      {
        method: 'POST',
        body: JSON.stringify({ accountId, amountPaise, note }),
      },
      idempotencyKey,
    );
  }

  async transfer(sourceAccountId: string, destinationAccountId: string, amountPaise: number, note?: string, idempotencyKey?: string): Promise<ApiResponse<{ transaction: Transaction }>> {
    return this.request<{ transaction: Transaction }>(
      '/transactions/transfer',
      {
        method: 'POST',
        body: JSON.stringify({ sourceAccountId, destinationAccountId, amountPaise, note }),
      },
      idempotencyKey,
    );
  }

  async listTransactions(params?: { accountId?: string; type?: string; limit?: number }): Promise<ApiResponse<{ transactions: Transaction[] }>> {
    const q = new URLSearchParams();
    if (params?.accountId) q.set('accountId', params.accountId);
    if (params?.type) q.set('type', params.type);
    if (params?.limit) q.set('limit', String(params.limit));
    return this.request<{ transactions: Transaction[] }>(`/transactions?${q.toString()}`);
  }

  // ===== System Observability =====
  async getClusterOverview(): Promise<ApiResponse<ClusterOverview>> {
    return this.request<ClusterOverview>('/system/overview');
  }

  async getNodes(): Promise<ApiResponse<NodeStatus[]>> {
    return this.request<NodeStatus[]>('/system/nodes');
  }

  async getLeader(): Promise<ApiResponse<{ leaderId: number; epoch: number; ready: boolean }>> {
    return this.request<{ leaderId: number; epoch: number; ready: boolean }>('/system/leader');
  }

  async getLoadMetrics(): Promise<ApiResponse<LoadMetrics>> {
    return this.request<LoadMetrics>('/system/load');
  }

  async getClocks(): Promise<ApiResponse<ClockState[]>> {
    return this.request<ClockState[]>('/system/clocks');
  }

  async getClockHistory(limit = 10): Promise<ApiResponse<{ rounds: ClockHistoryRound[] }>> {
    return this.request<{ rounds: ClockHistoryRound[] }>(`/system/clocks/history?limit=${limit}`);
  }

  async getElections(limit = 20): Promise<ApiResponse<{ elections: ElectionRecord[] }>> {
    return this.request<{ elections: ElectionRecord[] }>(`/system/elections?limit=${limit}`);
  }

  async getEvents(limit = 50, type?: string): Promise<ApiResponse<{ events: SystemEvent[] }>> {
    const q = new URLSearchParams({ limit: String(limit) });
    if (type) q.set('type', type);
    return this.request<{ events: SystemEvent[] }>(`/system/events?${q.toString()}`);
  }

  async getReplicationState(): Promise<ApiResponse<any>> {
    return this.request<any>('/system/replication');
  }

  async getIntegrity(): Promise<ApiResponse<any>> {
    return this.request<any>('/system/integrity');
  }

  // ===== Lab Actions =====
  async triggerElection(algorithm: 'bully' | 'ring', initiatorNodeId = 1): Promise<ApiResponse<any>> {
    return this.request<any>(`/lab/election/${algorithm}`, {
      method: 'POST',
      body: JSON.stringify({ initiatorNodeId }),
    });
  }

  async triggerClockSync(masterNodeId = 1): Promise<ApiResponse<any>> {
    return this.request<any>('/lab/clock/synchronize', {
      method: 'POST',
      body: JSON.stringify({ masterNodeId }),
    });
  }

  async setFaultMode(nodeId: number, mode: 'NONE' | 'CRASH' | 'PARTITION'): Promise<ApiResponse<any>> {
    return this.request<any>(`/lab/nodes/${nodeId}/fault`, {
      method: 'POST',
      body: JSON.stringify({ mode }),
    });
  }

  async setReplicationDelay(nodeId: number, delayMs: number): Promise<ApiResponse<any>> {
    return this.request<any>(`/lab/nodes/${nodeId}/replication-delay`, {
      method: 'PUT',
      body: JSON.stringify({ delayMs }),
    });
  }

  async setNodeLatency(nodeId: number, latencyMs: number): Promise<ApiResponse<any>> {
    return this.request<any>(`/lab/nodes/${nodeId}/latency`, {
      method: 'PUT',
      body: JSON.stringify({ latencyMs }),
    });
  }

  async setConsistencyMode(mode: 'strong' | 'eventual'): Promise<ApiResponse<any>> {
    return this.request<any>('/lab/config/consistency-mode', {
      method: 'PUT',
      body: JSON.stringify({ mode }),
    });
  }

  async runSyntheticLoad(count = 50, concurrency = 10, workMs = 50): Promise<ApiResponse<any>> {
    return this.request<any>('/lab/load/run', {
      method: 'POST',
      body: JSON.stringify({ count, concurrency, workMs }),
    });
  }

  async runConcurrencyScenario(scenario: string, params: Record<string, any> = {}): Promise<ApiResponse<any>> {
    return this.request<any>('/lab/concurrency/run', {
      method: 'POST',
      body: JSON.stringify({ scenario, ...params }),
    });
  }

  async runCpuTask(mode: 'MAIN' | 'WORKER', iterations = 1000000, parallel = 2): Promise<ApiResponse<any>> {
    return this.request<any>('/lab/concurrency/cpu-task', {
      method: 'POST',
      body: JSON.stringify({ mode, iterations, parallel }),
    });
  }

  async traceCall(fromNodeId: number, toNodeId: number): Promise<ApiResponse<any>> {
    return this.request<any>('/lab/rpc/trace-call', {
      method: 'POST',
      body: JSON.stringify({ fromNodeId, toNodeId }),
    });
  }
}

export const api = new ApiClient();
