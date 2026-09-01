#!/usr/bin/env node
/**
 * windirstat-mcp Docker Manager
 * Handles container lifecycle: reuse, start, stop, cleanup
 */

import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const IMAGE_NAME = 'windirstat-mcp';
const CONTAINER_NAME = 'windirstat-mcp-server';
const PROJECT_DIR = path.resolve(process.cwd());
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

let containerProcess = null;
let idleTimer = null;

function log(...args) {
  console.error(`[mcp-manager]`, ...args);
}

function runCmd(cmd, args = [], opts = {}) {
  try {
    const result = spawnSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', shell: false, ...opts });
    if (result.status !== 0) {
      if (result.stdout) return result.stdout.trim();
      if (result.stderr) return result.stderr.trim();
      throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
    }
    return result.stdout ? result.stdout.trim() : '';
  } catch (e) {
    if (e.stdout) return e.stdout.trim();
    if (e.stderr) return e.stderr.trim();
    throw e;
  }
}

function containerExists() {
  const names = runCmd('docker', ['ps', '-a', '--format', '{{.Names}}'])
    .split(/\r?\n/)
    .filter(Boolean);
  return names.includes(CONTAINER_NAME);
}

function containerRunning() {
  const names = runCmd('docker', ['ps', '--format', '{{.Names}}'])
    .split(/\r?\n/)
    .filter(Boolean);
  return names.includes(CONTAINER_NAME);
}

function buildImage() {
  log('Building Docker image...');
  runCmd('docker', ['build', '-t', IMAGE_NAME, PROJECT_DIR]);
}

function setupSignalHandlers() {
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(sig => {
    process.once(sig, () => {
      log(`Received ${sig}, stopping container...`);
      stopContainer();
      process.exit(0);
    });
  });
}

function startContainer() {
  setupSignalHandlers();

  if (containerRunning()) {
    log('Container already running, reusing');
    return attachToContainer();
  }

  if (containerExists()) {
    log('Starting existing container...');
    runCmd('docker', ['start', CONTAINER_NAME]);
    return attachToContainer();
  }

  log('Creating new container...');
  buildImage();

  const dockerArgs = [
    'run', '-i',
    '--name', CONTAINER_NAME,
    '-v', `${PROJECT_DIR}:/app`,
    '-v', `C:/:/host-c:ro`,
    IMAGE_NAME
  ];

  containerProcess = spawn('docker', dockerArgs, {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  containerProcess.stdout.on('data', (data) => {
    process.stdout.write(data);
    resetIdleTimer();
  });

  containerProcess.stderr.on('data', (data) => {
    process.stderr.write(data);
  });

  containerProcess.on('exit', (code) => {
    log(`Container exited with code ${code}`);
    containerProcess = null;
    if (idleTimer) clearTimeout(idleTimer);
    process.exit(code || 0);
  });

  process.stdin.on('data', (data) => {
    if (containerProcess && !containerProcess.killed) {
      containerProcess.stdin.write(data);
      resetIdleTimer();
    }
  });

  resetIdleTimer();
}

function attachToContainer() {
  log('Attaching to container...');
  containerProcess = spawn('docker', ['attach', CONTAINER_NAME], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  containerProcess.stdout.on('data', (data) => {
    process.stdout.write(data);
    resetIdleTimer();
  });

  containerProcess.stderr.on('data', (data) => {
    process.stderr.write(data);
  });

  containerProcess.on('exit', (code) => {
    log(`Container process exited with code ${code}`);
    containerProcess = null;
    if (idleTimer) clearTimeout(idleTimer);
    process.exit(code || 0);
  });

  process.stdin.on('data', (data) => {
    if (containerProcess && !containerProcess.killed) {
      containerProcess.stdin.write(data);
      resetIdleTimer();
    }
  });

  resetIdleTimer();
}

function stopContainer() {
  if (containerProcess && !containerProcess.killed) {
    containerProcess.kill('SIGTERM');
    containerProcess = null;
  }
  // Don't remove - let Docker --rm handle it, or keep for reuse
  try {
    runCmd('docker', ['stop', CONTAINER_NAME, '--time=5']);
  } catch {}
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    log(`Idle timeout (${IDLE_TIMEOUT_MS/60000}min) reached, stopping container...`);
    stopContainer();
    // Exit manager - container will be cleaned up by --rm or kept for reuse
    process.exit(0);
  }, IDLE_TIMEOUT_MS);
}

// Main
log('Starting windirstat-mcp Docker Manager');
startContainer();
