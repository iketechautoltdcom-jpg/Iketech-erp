// Run the restore drill last so it backs up a database full of realistic test activity.
const Sequencer = require('@jest/test-sequencer').default;
module.exports = class extends Sequencer {
  sort(tests) { return [...tests].sort((a, b) => (a.path.includes('backup') ? 1 : 0) - (b.path.includes('backup') ? 1 : 0) || a.path.localeCompare(b.path)); }
};
