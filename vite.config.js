import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

// Build stamp, baked into the bundle so the running frontend can say which commit
// it came from. Without this there is no way to tell a rebuilt bundle from a
// stale one, which made "did my deploy actually take?" a guessing game.
//
// Every lookup is guarded: a build from a tarball with no .git, or on a machine
// without git, must still succeed.
function gitInfo() {
  const run = (cmd) => {
    try {
      return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return '';
    }
  };

  return {
    sha: run('git rev-parse --short HEAD') || 'unknown',
    branch: run('git rev-parse --abbrev-ref HEAD') || 'unknown',
    // Marks a build made from a working tree with uncommitted changes, so a
    // hand-edited deploy is visibly not reproducible from the repo.
    dirty: Boolean(run('git status --porcelain')),
  };
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync('./package.json', 'utf-8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const git = gitInfo();

export default defineConfig({
  plugins: [react()],

  define: {
    __APP_VERSION__: JSON.stringify(packageVersion()),
    __BUILD_SHA__: JSON.stringify(git.sha),
    __BUILD_BRANCH__: JSON.stringify(git.branch),
    __BUILD_DIRTY__: JSON.stringify(git.dirty),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },

  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'https://app.omnireach.my.id',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: process.env.VITE_PROXY_TARGET || 'https://app.omnireach.my.id',
        ws: true,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
