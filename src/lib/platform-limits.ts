/** Chrome and application limits that constrain persisted user-facing feature capacity. */
export const MAX_BLOCKED_SITES = 5_000;
export const MAX_START_PAGE_BLOCKS = 1_000;
export const MAX_CUSTOM_THEMES = 1_000;
export const MAX_LOCAL_TASKS_PER_INSTANCE = 10_000;
export const MAX_LOCAL_TASK_TITLE_LENGTH = 500;
export const MAX_NOTE_LENGTH = 200_000;

// The row range leaves enough room to place every supported block at the
// maximum height without overlap, even when all blocks share one column.
export const MAX_GRID_BLOCK_HEIGHT = 80;
export const MAX_GRID_ROW = MAX_START_PAGE_BLOCKS * MAX_GRID_BLOCK_HEIGHT + 1;
