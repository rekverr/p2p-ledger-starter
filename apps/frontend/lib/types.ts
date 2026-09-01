export interface Principal {
  userId: string;
  email: string;
  role: string;
}

export interface Wallet {
  id: string;
  ownerId: string;
  currency: string;
  balance: string;
  held: string;
  available: string;
}

export type TransferStatus =
  | 'Pending'
  | 'Validating'
  | 'FundsHeld'
  | 'Processing'
  | 'Completed'
  | 'Compensating'
  | 'Failed';

export interface Transfer {
  id: string;
  senderWalletId: string;
  receiverReference: string;
  amount: string;
  currency: string;
  destinationAmount: string;
  destinationCurrency: string;
  fxRate: string;
  status: TransferStatus;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface Activity {
  id: string;
  eventId: string;
  eventType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ActivityPage {
  items: Activity[];
  nextCursor: string | null;
}

export interface SplitShare {
  id: string;
  participantUserId: string;
  amount: string;
  paymentStatus: 'Unpaid' | 'PaymentPending' | 'PaymentFailed' | 'Paid';
  transferId: string | null;
  transferStatus: TransferStatus | null;
}

export interface SplitBill {
  id: string;
  creatorUserId: string;
  creatorReference: string;
  total: string;
  currency: string;
  deadline: string | null;
  status: 'Pending' | 'PartiallyPaid' | 'Settled';
  shares: SplitShare[];
  createdAt: string;
  updatedAt: string;
}

export interface Dashboard {
  me: Principal;
  wallets: Wallet[];
  activity: ActivityPage;
  splitBills: SplitBill[];
}
