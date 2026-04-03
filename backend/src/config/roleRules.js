/**
 * PROMPT 56 — Role rule engine (base for flexibility).
 * All scheduling decisions should reference this config.
 */
const ROLE_RULES = {
  strategist: {
    minDays: 1,
    maxDays: 1,
    flexible: false,
    canBorrow: false,
    canSplit: false,
  },
  shoot: {
    minDays: 1,
    maxDays: 3,
    flexible: true,
    canBorrow: true,
    canSplit: true,
  },
  editor: {
    minDays: 1,
    maxDays: 4,
    flexible: true,
    canBorrow: true,
    canSplit: true,
  },
  /** Reel approve: up to 3d; static/carousel approve window uses up to 4d via planned duration. */
  manager: {
    minDays: 1,
    maxDays: 4,
    flexible: true,
    canBorrow: true,
    canSplit: true,
  },
  graphicDesigner: {
    minDays: 1,
    maxDays: 1,
    flexible: false,
    canBorrow: false,
    canSplit: true,
  },
  post: {
    minDays: 1,
    maxDays: 1,
    flexible: false,
    fixed: true,
  },
};

module.exports = {
  ROLE_RULES,
};
