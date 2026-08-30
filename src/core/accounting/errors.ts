export class AccountingError extends Error {
  constructor(message: string, public readonly code: string = "ACCOUNTING_ERROR") {
    super(message);
    this.name = "AccountingError";
  }
}

export class ValidationError extends AccountingError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

export class UnbalancedVoucherError extends AccountingError {
  constructor(debit: number, credit: number) {
    super(`Voucher is not balanced. Debit=${debit}, Credit=${credit}`, "UNBALANCED_VOUCHER");
    this.name = "UnbalancedVoucherError";
  }
}

export class PostedVoucherMutationError extends AccountingError {
  constructor() {
    super("A posted voucher cannot be edited or deleted. Cancel it and create a reversal/correcting voucher.", "POSTED_VOUCHER_IMMUTABLE");
    this.name = "PostedVoucherMutationError";
  }
}

export class NotFoundError extends AccountingError {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class DuplicateVoucherError extends AccountingError {
  constructor(number: string) {
    super(`Voucher number already allocated: ${number}`, "DUPLICATE_VOUCHER_NUMBER");
    this.name = "DuplicateVoucherError";
  }
}
