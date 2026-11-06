import { describe, it, beforeEach, afterEach } from 'node:test';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { defineDbConformance } from '../src/db-conformance.js';
import { betterSqlite3Driver } from '../src/driver-better-sqlite3.js';
import { createSqliteWasmDriver } from '../src/driver-sqlite-wasm.js';

const t = { describe, it, beforeEach, afterEach };
const sqlite3 = await sqlite3InitModule();

defineDbConformance(t, 'better-sqlite3', () => betterSqlite3Driver);
defineDbConformance(t, 'sqlite-wasm', () => createSqliteWasmDriver(sqlite3));
