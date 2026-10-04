// In-memory Nessie fake with the same interface as the live client. State is lost on restart.
import type { NessieAccount, NessieApi, NessieCustomer, NessieMerchant, NessiePurchase } from "./client";

const customers = new Map<string, NessieCustomer>();
const accounts = new Map<string, NessieAccount>();
const merchants = new Map<string, NessieMerchant>();
const purchases = new Map<string, NessiePurchase>();

const mockIds = new Set<string>();

// 24 hex chars, same shape as Nessie's Mongo ids.
function fakeId(): string {
  const id = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
  mockIds.add(id);
  return id;
}

// True when an id came from this mock (including live calls that fell back), so callers don't persist it as live.
export function isMockId(id: string): boolean {
  return mockIds.has(id);
}

export function today(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Detroit" });
}

export const mockNessie: NessieApi = {
  async createCustomer(firstName, lastName) {
    const c = { id: fakeId(), firstName, lastName };
    customers.set(c.id, c);
    return c;
  },

  async createAccount(customerId, nickname) {
    const a = { id: fakeId(), customerId, nickname };
    accounts.set(a.id, a);
    return a;
  },

  async createMerchant(name, category) {
    const m = { id: fakeId(), name, category };
    merchants.set(m.id, m);
    return m;
  },

  async listMerchants() {
    return [...merchants.values()];
  },

  async getPurchases(accountId) {
    return [...purchases.values()].filter((p) => p.accountId === accountId);
  },

  // Unknown merchant ids are accepted: db rows from a previous run point at merchants this process never saw.
  async createPurchase(accountId, merchantId, amount, description) {
    const p: NessiePurchase = {
      id: fakeId(),
      accountId,
      merchantId,
      amount,
      description,
      purchaseDate: today(),
      status: "pending",
    };
    purchases.set(p.id, p);
    return p;
  },
};
