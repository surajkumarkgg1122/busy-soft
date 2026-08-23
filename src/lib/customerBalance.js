import {
  addDoc,
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

export function saleOutstanding(sale) {
  if (!sale.customerId) return 0;
  return Math.max(0, Number(sale.total || 0) - Number(sale.paid || 0));
}

export async function applyCustomerBalanceChanges(db, changes) {
  const normalizedChanges = changes.filter(([, amount]) => amount).reduce((result, [customerId, amount]) => {
    result.set(customerId, (result.get(customerId) || 0) + amount);
    return result;
  }, new Map());

  if (!normalizedChanges.size) return;

  await runTransaction(db, async (transaction) => {
    const customerSnapshots = await Promise.all([...normalizedChanges.keys()].map((customerId) => transaction.get(doc(db, "customers", customerId))));
    customerSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists()) return;
      const customerId = [...normalizedChanges.keys()][index];
      const currentBalance = Number(snapshot.data().balance || 0);
      transaction.update(snapshot.ref, {
        balance: Math.max(0, currentBalance + normalizedChanges.get(customerId)),
        updatedAt: serverTimestamp(),
      });
    });
  });
}

export async function recordCustomerPayment(db, payment) {
  if (!payment.customerId) throw new Error("A customer is required for a customer payment.");
  const amount = Math.max(0, Number(payment.amount || 0));
  if (!amount) throw new Error("Payment amount must be greater than zero.");

  await runTransaction(db, async (transaction) => {
    const customerRef = doc(db, "customers", payment.customerId);
    const customerSnapshot = await transaction.get(customerRef);
    if (!customerSnapshot.exists()) throw new Error("Customer does not exist.");

    const paymentRef = doc(collection(db, "payments"));
    const currentBalance = Number(customerSnapshot.data().balance || 0);
    const balanceChange = payment.direction === "out" ? amount : -amount;
    const timestamp = serverTimestamp();

    transaction.set(paymentRef, {
      ...payment,
      amount,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    transaction.update(customerRef, {
      balance: Math.max(0, currentBalance + balanceChange),
      updatedAt: timestamp,
    });
  });
}
