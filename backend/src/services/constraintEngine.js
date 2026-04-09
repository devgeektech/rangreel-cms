/**
 * PROMPT 106 — Unified constraint engine entry: per-day checks from `constraintEngine.service.js`,
 * move validation / borrowing from `constraintEngine.moveValidation.js`.
 *
 * Note: `constraintEngine.service.js` may be root-owned in some environments; new logic lives in
 * `constraintEngine.moveValidation.js` and is merged here.
 */
const core = require("./constraintEngine.service");
const move = require("./constraintEngine.moveValidation");

module.exports = {
  ...core,
  ...move,
};
