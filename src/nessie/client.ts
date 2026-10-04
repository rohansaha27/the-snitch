// Live Capital One Nessie client. Every call has an 8s timeout and falls back to the mock on failure,
// so a flaky Nessie never takes the demo down.
import { config } from "../config";
import { mockNessie, today } from "./mock";

export interface NessieCustomer { id: string; firstName: string; lastName: string }
export interface NessieAccount { id: string; customerId: string; nickname: string }
export interface NessieMerchant { id: string; name: string; category: string }
export interface NessiePurchase {
  id: string;
  accountId: string;
  merchantId: string;
  amount: number;
  description: string;
  purchaseDate: string; // YYYY-MM-DD, Nessie has no time of day
  status: string;
}

export interface NessieApi {
  createCustomer(firstName: string, lastName: string): Promise<NessieCustomer>;
  createAccount(customerId: string, nickname: string): Promise<NessieAccount>;
  createMerchant(name: string, category: string): Promise<NessieMerchant>;
  listMerchants(): Promise<NessieMerchant[]>;
  getPurchases(accountId: string): Promise<NessiePurchase[]>;
  createPurchase(accountId: string, merchantId: string, amount: number, description: string): Promise<NessiePurchase>;
}

const TIMEOUT_MS = 8000;

// Every Nessie object we create lives "in Ann Arbor" (address + geocode are required fields).
const ADDRESS = { street_number: "500", street_name: "S State St", city: "Ann Arbor", state: "MI", zip: "48109" };
const GEOCODE = { lat: 42.2780, lng: -83.7382 };

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const url = `${config.nessieBaseUrl}${path}?key=${encodeURIComponent(config.nessieApiKey ?? "")}`;
  const started = Date.now();
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  console.log(`[nessie] ${method} ${path} ${res.status} ${Date.now() - started}ms`);
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  const json = text ? JSON.parse(text) : null;
  // POSTs wrap the new object as { code, message, objectCreated }.
  return (json?.objectCreated ?? json) as T;
}

// Runs the live call; on any error logs it and runs the mock instead.
async function withFallback<T>(label: string, live: () => Promise<T>, mock: () => Promise<T>): Promise<T> {
  try {
    return await live();
  } catch (err) {
    console.error(`[nessie] ${label} failed, using mock:`, (err as Error).message);
    return mock();
  }
}

type RawMerchant = { _id: string; name: string; category?: string | string[] };
type RawPurchase = {
  _id: string;
  payer_id: string;
  merchant_id: string;
  amount: number;
  description?: string;
  purchase_date?: string;
  status?: string;
};

function toMerchant(m: RawMerchant): NessieMerchant {
  const category = Array.isArray(m.category) ? m.category[0] : m.category;
  return { id: m._id, name: m.name, category: category ?? "misc" };
}

function toPurchase(p: RawPurchase): NessiePurchase {
  return {
    id: p._id,
    accountId: p.payer_id,
    merchantId: p.merchant_id,
    amount: Number(p.amount),
    description: p.description ?? "",
    purchaseDate: p.purchase_date ?? today(),
    status: p.status ?? "pending",
  };
}

export const liveNessie: NessieApi = {
  createCustomer: (firstName, lastName) =>
    withFallback(
      "createCustomer",
      async () => {
        const c = await call<{ _id: string }>("POST", "/customers", {
          first_name: firstName,
          last_name: lastName,
          address: ADDRESS,
        });
        return { id: c._id, firstName, lastName };
      },
      () => mockNessie.createCustomer(firstName, lastName),
    ),

  createAccount: (customerId, nickname) =>
    withFallback(
      "createAccount",
      async () => {
        const a = await call<{ _id: string }>("POST", `/customers/${customerId}/accounts`, {
          type: "Credit Card",
          nickname,
          rewards: 0,
          balance: 0,
        });
        return { id: a._id, customerId, nickname };
      },
      () => mockNessie.createAccount(customerId, nickname),
    ),

  createMerchant: (name, category) =>
    withFallback(
      "createMerchant",
      async () => {
        const m = await call<RawMerchant>("POST", "/merchants", {
          name,
          category,
          address: ADDRESS,
          geocode: GEOCODE,
        });
        return { id: m._id, name, category };
      },
      () => mockNessie.createMerchant(name, category),
    ),

  listMerchants: () =>
    withFallback(
      "listMerchants",
      async () => (await call<RawMerchant[]>("GET", "/merchants")).map(toMerchant),
      () => mockNessie.listMerchants(),
    ),

  getPurchases: (accountId) =>
    withFallback(
      "getPurchases",
      async () => (await call<RawPurchase[]>("GET", `/accounts/${accountId}/purchases`)).map(toPurchase),
      () => mockNessie.getPurchases(accountId),
    ),

  createPurchase: (accountId, merchantId, amount, description) =>
    withFallback(
      "createPurchase",
      async () => {
        const p = await call<RawPurchase>("POST", `/accounts/${accountId}/purchases`, {
          merchant_id: merchantId,
          medium: "balance",
          purchase_date: today(),
          amount,
          status: "pending",
          description,
        });
        return toPurchase({ ...p, payer_id: p.payer_id ?? accountId, merchant_id: p.merchant_id ?? merchantId, amount: p.amount ?? amount });
      },
      () => mockNessie.createPurchase(accountId, merchantId, amount, description),
    ),
};

export const nessie: NessieApi = config.nessieMode === "live" ? liveNessie : mockNessie;
