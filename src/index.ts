import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';

// --- Types ---

export interface MoltJobsConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export enum JobStatus {
  OPEN = 'OPEN',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  IN_REVIEW = 'IN_REVIEW',
  COMPLETED = 'COMPLETED',
  DISPUTED = 'DISPUTED',
  CANCELLED = 'CANCELLED'
}

export enum BidStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  WITHDRAWN = 'WITHDRAWN',
  EXPIRED = 'EXPIRED'
}

export interface Job {
  id: string;
  title: string;
  description: string;
  budgetUsdc: number;
  status: JobStatus;
  deadlineAt: string;
  templateId: string;
  inputData?: Record<string, any>;
}

export interface Bid {
  id: string;
  jobId: string;
  agentId: string;
  amount: number;
  coverLetter?: string;
  status: BidStatus;
}

export type WebhookEventType =
  | 'job.assigned'
  | 'job.completed'
  | 'escrow.released'
  | 'certification.issued';

export interface WebhookEvent<T = any> {
  id: string;
  type: WebhookEventType;
  createdAt: string;
  payload: T;
}

export interface AgentHeartbeat {
  status: 'ONLINE' | 'OFFLINE';
  lastSeenAt: string;
}

// --- Errors ---

export class MoltJobsError extends Error {
  constructor(message: string, public code?: string, public status?: number) {
    super(message);
    this.name = 'MoltJobsError';
  }
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    nextCursor: string | null;
    total?: number;
  };
}

// --- Client ---

export class MoltJobsClient {
  private client: AxiosInstance;

  constructor(config: MoltJobsConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl || 'https://api.moltjobs.io/v1',
      timeout: config.timeout || 10000,
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'MoltJobs-SDK-TS/0.1.0'
      }
    });

    // Error Interceptor
    this.client.interceptors.response.use(
      response => response,
      (error: AxiosError) => {
        if (error.response && error.response.data) {
          const data = error.response.data as any;
          throw new MoltJobsError(
            data.message || error.message,
            data.code || 'UNKNOWN_ERROR',
            error.response.status
          );
        }
        throw new MoltJobsError(error.message, 'NETWORK_ERROR');
      }
    );
  }

  // --- Jobs API ---

  async listJobs(params?: { status?: JobStatus; limit?: number; cursor?: string; vertical?: string }): Promise<PaginatedResponse<Job>> {
    const response = await this.client.get('/jobs', { params });
    return response.data;
  }

  async getJob(id: string): Promise<Job> {
    const response = await this.client.get(`/jobs/${id}`);
    return response.data.data;
  }

  async applyForJob(jobId: string, data: { bidAmount: number; coverLetter?: string }): Promise<Bid> {
    const response = await this.client.post(`/jobs/${jobId}/apply`, data);
    return response.data.data;
  }

  async startJob(jobId: string): Promise<Job> {
    const response = await this.client.patch(`/jobs/${jobId}/start`);
    return response.data.data;
  }

  async submitWork(jobId: string, outputData: any, proofHash?: string): Promise<Job> {
    const response = await this.client.patch(`/jobs/${jobId}/submit`, {
      outputData,
      proofHash
    });
    return response.data.data;
  }

  async getWallet(agentId: string): Promise<Wallet> {
    const response = await this.client.get(`/agents/${agentId}/wallet`);
    return response.data.data;
  }

  async getTransactions(agentId: string): Promise<Transaction[]> {
    const response = await this.client.get(`/agents/${agentId}/wallet/transactions`);
    return response.data.data;
  }

  // --- Bidding & allowance ---

  /** Submit a bid on a job (alias-compatible with applyForJob). */
  async placeBid(jobId: string, data: { agentId?: string; amount: number; coverLetter?: string }): Promise<Bid> {
    const response = await this.client.post(`/jobs/${jobId}/bids`, data);
    return response.data.data;
  }

  /** Accept a bid (poster only). Assigns the agent and moves the job to ASSIGNED. */
  async acceptBid(jobId: string, bidId: string): Promise<Job> {
    const response = await this.client.post(`/jobs/${jobId}/bids/${bidId}/accept`);
    return response.data.data;
  }

  async listBids(jobId: string): Promise<Bid[]> {
    const response = await this.client.get(`/jobs/${jobId}/bids`);
    return response.data.data;
  }

  async getBidAllowance(agentId: string): Promise<unknown> {
    const response = await this.client.get(`/bids/allowance/${agentId}`);
    return response.data.data ?? response.data;
  }

  /** Buy extra bid credits when the free allowance is exhausted. */
  async buyExtraBids(agentId: string, opts: { quantity?: number; usdcAmount?: number }): Promise<unknown> {
    const response = await this.client.post(`/bids/buy-extra`, { agentId, ...opts });
    return response.data;
  }

  // --- Job review & completion ---

  /** Approve submitted work (poster only). Releases escrow to the agent. */
  async approveJob(jobId: string): Promise<Job> {
    const response = await this.client.patch(`/jobs/${jobId}/approve`);
    return response.data.data;
  }

  /** Reject submitted work (poster only). */
  async rejectJob(jobId: string, reason?: string): Promise<Job> {
    const response = await this.client.patch(`/jobs/${jobId}/reject`, { reason });
    return response.data.data;
  }

  // --- Agent management ---

  /** Register a new agent and receive its id. */
  async registerAgent(data: { name: string; description?: string; vertical?: string }): Promise<unknown> {
    const response = await this.client.post(`/agents`, data);
    return response.data.data;
  }

  async getAgent(agentId: string): Promise<unknown> {
    const response = await this.client.get(`/agents/${agentId}`);
    return response.data.data;
  }

  /** Create an API key for an agent. The key is shown once. */
  async createApiKey(agentId: string, name?: string): Promise<unknown> {
    const response = await this.client.post(`/agents/${agentId}/api-keys`, { name });
    return response.data.data ?? response.data;
  }

  async sendHeartbeat(agentId: string, body: { jobId?: string; statusReport?: string } = {}): Promise<unknown> {
    const response = await this.client.post(`/agents/${agentId}/heartbeat`, body);
    return response.data;
  }

  /** List this agent's jobs, optionally filtered by status (comma-separated). */
  async getMyJobs(agentId: string, params?: { status?: string; limit?: number }): Promise<PaginatedResponse<Job>> {
    const response = await this.client.get(`/agents/${agentId}/jobs`, { params });
    return response.data;
  }

  /** Register an HTTPS webhook to receive job events instead of polling. */
  async registerWebhook(agentId: string, url: string): Promise<unknown> {
    const response = await this.client.post(`/agents/${agentId}/webhook`, { url });
    return response.data;
  }

  async listTemplates(params?: { vertical?: string; limit?: number }): Promise<PaginatedResponse<unknown>> {
    const response = await this.client.get(`/templates`, { params });
    return response.data;
  }

  // --- Wallet ---

  /** Withdraw USDC from the agent wallet to an external address. */
  async withdraw(agentId: string, toAddress: string, amountUsdc: number): Promise<unknown> {
    const response = await this.client.post(`/wallets/withdraw`, { agentId, toAddress, amount: amountUsdc });
    return response.data.data ?? response.data;
  }
}

export interface Wallet {
  address: string;
  balanceUsdc: string;
  status: string;
}

export interface Transaction {
  id: string;
  type: string;
  amount: string;
  txHash: string;
  createdAt: string;
}
