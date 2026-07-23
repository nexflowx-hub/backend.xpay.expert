import {
  recordStripeSettlementShadow
} from './settlement-shadow.service';

import {
  reconcileSettlementTransaction
} from './ledger-reconciliation.service';

type SettlementInput = {
  eventId: string;
  eventType: string;
  livemode: boolean;
  transactionId: string;
  gatewayVaultId: string;
  paymentIntentId: string;
};

export async function recordStripeSettlementAndReconcile(
  input: SettlementInput
) {
  const settlement =
    await recordStripeSettlementShadow(
      input
    );

  const reconciliation =
    await reconcileSettlementTransaction(
      input.transactionId
    );

  return {
    ...settlement,
    reconciliation
  };
}
