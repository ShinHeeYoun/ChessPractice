const chokidar = require('chokidar');
const { exec } = require('child_process');

// Watch all files in the directory except node_modules and .git
const watcher = chokidar.watch('.', {
  ignored: /(^|[\/\\])\..|node_modules|dist|build/,
  persistent: true,
  ignoreInitial: true
});

let timeout = null;
const DEBOUNCE_DELAY = 10000; // 10 seconds

function commitAndPush() {
  console.log('[Auto-commit] Changes detected, committing...');
  exec('git add . && git commit -m "auto: update" && git push origin main', (err, stdout, stderr) => {
    if (err) {
      if (err.message.includes('nothing to commit')) {
        console.log('[Auto-commit] No changes to commit.');
        return;
      }
      console.error(`[Auto-commit] Error: ${err.message}`);
      return;
    }
    console.log(`[Auto-commit] Successfully pushed changes:\n${stdout}`);
  });
}

watcher.on('all', (event, path) => {
  console.log(`[Watcher] ${event} at ${path}`);
  if (timeout) {
    clearTimeout(timeout);
  }
  timeout = setTimeout(commitAndPush, DEBOUNCE_DELAY);
});

console.log(`[Watcher] Watching for file changes. Auto-commit debounce: ${DEBOUNCE_DELAY/1000}s`);
