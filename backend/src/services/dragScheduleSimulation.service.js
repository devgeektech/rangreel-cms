/**
 * PROMPT 109 — Drag API: simulate schedule / borrow before rejecting on sequence or validation failure.
 */

const { validateMove } = require("./constraintEngine.moveValidation");
const { tryBorrowBeforeFail107 } = require("./globalScheduler.service");

/**
 * Run after a proposed move is applied to draft stages. Tries borrowing from the next stage first,
 * then checks move-level borrow allowance (leave / capacity hints).
 *
 * @param {object[]} tasks — duration tasks (`normalizeDraftItemToDurationTasks`)
 * @param {object} options
 * @param {object} options.movedTask — task for the dragged stage
 * @param {Date} options.newDate — resolved anchor date for that stage
 * @param {Record<string, number>} options.durationPlan — mutable reel/post-like plan
 * @param {"reel"|"post_like"} options.pipelineKind
 * @param {string} options.movedWorkflowRole — workflow role string (e.g. videographer)
 * @returns {Promise<{ allowBorrow: boolean, borrowingApplied: boolean, borrowMeta?: object, validateMove?: object, borrowAttempted?: object }>}
 */
async function simulateSchedule(tasks, options = {}) {
  const {
    movedTask,
    newDate,
    durationPlan,
    pipelineKind,
    movedWorkflowRole,
  } = options;

  if (!Array.isArray(tasks) || !movedTask || newDate == null || !durationPlan || !pipelineKind) {
    return { allowBorrow: false, borrowingApplied: false };
  }

  const br = tryBorrowBeforeFail107({
    role: movedWorkflowRole,
    currentTask: movedTask,
    tasks,
    durationPlan,
    pipelineKind,
  });

  if (br && br.ok === true) {
    return {
      allowBorrow: true,
      borrowingApplied: true,
      borrowMeta: br,
    };
  }

  const vm = validateMove(movedTask, newDate, tasks);
  if (vm && vm.allowBorrow === true) {
    return {
      allowBorrow: true,
      borrowingApplied: false,
      validateMove: vm,
    };
  }

  return {
    allowBorrow: false,
    borrowingApplied: false,
    validateMove: vm,
    borrowAttempted: br,
  };
}

module.exports = {
  simulateSchedule,
};
