// Shapes of the Investec SA Private Banking API, as verified in docs/INVESTEC_API_NOTES.md.
// Amounts in responses are rands as JSON numbers. Amounts in requests are rand strings like "150.00".

export type Envelope<T> = {
  data: T;
  links: { self: string };
  meta: { totalPages: number };
};

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
};

export type Account = {
  accountId: string;
  accountNumber: string;
  accountName: string;
  referenceName: string;
  productName: string;
  kycCompliant: boolean;
  profileId: string;
  profileName?: string;
};

export type Balance = {
  accountId: string;
  currentBalance: number;
  availableBalance: number;
  budgetBalance?: number;
  straightBalance?: number;
  cashBalance?: number;
  currency: string;
};

export type Transaction = {
  accountId: string;
  type: "CREDIT" | "DEBIT";
  transactionType: string | null;
  status: "POSTED" | "PENDING";
  description: string;
  cardNumber: string | null;
  postedOrder: number;
  postingDate: string | null;
  valueDate: string | null;
  actionDate: string | null;
  transactionDate: string;
  amount: number;
  runningBalance: number;
  uuid?: string;
};

export type Beneficiary = {
  beneficiaryId: string;
  accountNumber: string;
  code: string;
  bank: string;
  beneficiaryName: string;
  lastPaymentAmount: string;
  lastPaymentDate: string;
  cellNo: string | null;
  emailAddress: string | null;
  name: string;
  referenceAccountNumber: string;
  referenceName: string;
  categoryId: string;
  profileId: string;
  fasterPaymentAllowed?: boolean;
};

export type TransferItem = {
  beneficiaryAccountId: string;
  amount: string;
  myReference: string;
  theirReference: string;
};

export type PaymentItem = {
  beneficiaryId: string;
  amount: string;
  myReference: string;
  theirReference: string;
};

export type TransferResponse = {
  PaymentReferenceNumber: string;
  PaymentDate: string;
  Status: string;
  BeneficiaryName: string;
  BeneficiaryAccountId: string;
  AuthorisationRequired: boolean;
};

export type TransferResult = {
  TransferResponses: TransferResponse[];
  ErrorMessage: string | null;
};
