import type { Logger } from "../log.js";
import type {
  Account,
  Balance,
  Beneficiary,
  Envelope,
  PaymentItem,
  TokenResponse,
  Transaction,
  TransferItem,
  TransferResult,
} from "./types.js";

export type InvestecClientOptions = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  apiKey: string;
  log: Logger;
  fetchImpl?: typeof fetch;
};

/**
 * A thin client for the SA Private Banking API. The same code talks to the sandbox and to the mock
 * server, which is the point: the mock has to look exactly like the real thing to the relayer.
 */
export class InvestecClient {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetch: typeof fetch;

  constructor(private readonly o: InvestecClientOptions) {
    this.fetch = o.fetchImpl ?? fetch;
  }

  get baseUrl() {
    return this.o.baseUrl;
  }

  async accessToken(): Promise<string> {
    // refresh a minute early; tokens last 1799 seconds
    if (this.token && this.token.expiresAt - 60_000 > Date.now()) return this.token.value;
    const basic = Buffer.from(`${this.o.clientId}:${this.o.clientSecret}`).toString("base64");
    const res = await this.fetch(`${this.o.baseUrl}/identity/v2/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "x-api-key": this.o.apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`token request failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as TokenResponse;
    this.token = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in) * 1000 };
    this.o.log.debug({ scope: body.scope, expiresIn: body.expires_in }, "investec token");
    return body.access_token;
  }

  async accounts(): Promise<Account[]> {
    const r = await this.get<Envelope<{ accounts: Account[] }>>("/za/pb/v1/accounts");
    return r.data.accounts;
  }

  async balance(accountId: string): Promise<Balance> {
    const r = await this.get<Envelope<Balance>>(`/za/pb/v1/accounts/${accountId}/balance`);
    return r.data;
  }

  async transactions(accountId: string, q: { fromDate?: string; toDate?: string } = {}): Promise<Transaction[]> {
    const params = new URLSearchParams();
    if (q.fromDate) params.set("fromDate", q.fromDate);
    if (q.toDate) params.set("toDate", q.toDate);
    const qs = params.size ? `?${params}` : "";
    const r = await this.get<Envelope<{ transactions: Transaction[] }>>(
      `/za/pb/v1/accounts/${accountId}/transactions${qs}`,
    );
    // the community simulator returns numeric fields as strings, the real API as numbers
    return r.data.transactions.map((t) => ({
      ...t,
      amount: Number(t.amount),
      runningBalance: Number(t.runningBalance),
      postedOrder: Number(t.postedOrder),
    }));
  }

  async beneficiaries(): Promise<Beneficiary[]> {
    const r = await this.get<Envelope<Beneficiary[] | { result: Beneficiary[] }>>("/za/pb/v1/accounts/beneficiaries");
    return Array.isArray(r.data) ? r.data : r.data.result;
  }

  /** transfermultiple: between accounts on the same profile. */
  async transfer(fromAccountId: string, list: TransferItem[], profileId?: string): Promise<TransferResult> {
    const body: Record<string, unknown> = { transferList: list };
    if (profileId) body.profileId = profileId;
    const r = await this.post<Envelope<TransferResult>>(`/za/pb/v1/accounts/${fromAccountId}/transfermultiple`, body);
    return r.data;
  }

  /** paymultiple: to a saved beneficiary. At most 50 per call. */
  async pay(fromAccountId: string, list: PaymentItem[]): Promise<TransferResult> {
    const r = await this.post<Envelope<TransferResult>>(`/za/pb/v1/accounts/${fromAccountId}/paymultiple`, {
      paymentList: list,
    });
    return r.data;
  }

  private async get<T>(path: string): Promise<T> {
    const token = await this.accessToken();
    const res = await this.fetch(`${this.o.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const token = await this.accessToken();
    const res = await this.fetch(`${this.o.baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }
}
