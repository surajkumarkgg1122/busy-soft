import { runAccountingInvariantTests } from "../src/core/accounting/testCases";
import { runStockSelfTest } from "../src/core/accounting/stockSelfTest";

const result = runAccountingInvariantTests();
console.log(`Accounting invariant tests: ${result.passed} passed, ${result.failed} failed`);
if (result.failed !== 0) process.exit(1);
if (result.passed < 7) { console.error("Accounting smoke suite is unexpectedly incomplete."); process.exit(1); }
runStockSelfTest();
console.log("Stock invariants: passed");
