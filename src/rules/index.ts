import type { Rule } from '../types.js';
import { authRules } from './auth.js';
import { dataRules } from './data.js';
import { operationsRules } from './operations.js';
import { paymentsRules } from './payments.js';
import { secretsRules } from './secrets.js';
import { testingRules } from './testing.js';

export const allRules: Rule[] = [
  ...secretsRules,
  ...authRules,
  ...paymentsRules,
  ...dataRules,
  ...testingRules,
  ...operationsRules,
];

export {
  authRules,
  dataRules,
  operationsRules,
  paymentsRules,
  secretsRules,
  testingRules,
};
