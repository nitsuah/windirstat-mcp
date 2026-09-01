#!/usr/bin/env node
/**
 * windirstat-mcp Docker Manager
 * Handles container lifecycle: reuse, start, stop, cleanup
 */

import { spawn, execSync } from 'child_process';
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

function runCmd(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
  } catch (e) {
    if (e.status !== 0 && e.stdout) return e.stdout.trim();
    if (e.status !== 0 && e.stderr) return e.stderr.trim();
    throw e;
  }
}

function containerExists() {
  try {
    runCmd(`docker ps -a --format '{{.Names}}' | grep -w ${CONTAINER_NAME}`);
    return true;
  } catch {
    return false;
  }
}

function containerRunning() {
  try {
    runCmd(`docker ps --format '{{.Names}}' | grep -w ${CONTAINER_NAME}`);
    return true;
  } catch {
    return false;
  }
}

function buildImage() {
  log('Building Docker image...');
  runCmd(`docker build -t ${IMAGE_NAME} ${PROJECT_DIR}`);
}

function startContainer() {
  if (containerRunning()) {
    log('Container already running, reusing');
    return attachToContainer();
  }

  if (containerExists()) {
    log('Starting existing container...');
    runCmd(`docker start ${CONTAINER_NAME}`);
    return attachToContainer();
  }

  log('Creating new container...');
  buildImage();
  
  const dockerArgs = [
    'run', '-i', '--rm',
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

  // Forward stdin to container
  process.stdin.on('data', (data) => {
    if (containerProcess && !containerProcess.killed) {
      containerProcess.stdin.write(data);
      resetIdleTimer();
    }
  });

  // Handle signals
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(sig => {
    process.on(sig, () => {
      log(`Received ${sig}, stopping container...`);
      stopContainer();
      process.exit(0);
    });
  });

  resetIdleTimer();
}

function attachToContainer() {
  log('Attaching to container...');
  containerProcess = spawn('docker', ['exec', '-i', CONTAINER_NAME, 'node', 'index.js'], {
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
    runCmd(`docker stop ${CONTAINER_NAME} --time=5`);
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
