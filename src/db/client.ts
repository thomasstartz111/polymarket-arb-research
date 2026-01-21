import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DbConfig {
  dbPath: string;
  verbose?: boolean;
}

class DatabaseClient {
  private db: Database.Database | null = null;
  private config: DbConfig;

  constructor(config?: Partial<DbConfig>) {
    const projectRoot = path.resolve(__dirname, '../..');
    this.config = {
      dbPath: config?.dbPath || path.join(projectRoot, 'data', 'polymarket.db'),
      verbose: config?.verbose || false,
    };
  }

  /**
   * Connect to database (lazy initialization)
   */
  connect(): Database.Database {
    if (this.db) return this.db;

    // Ensure data directory exists
    const dir = path.dirname(this.config.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.config.dbPath, {
      verbose: this.config.verbose ? console.log : undefined,
    });

    // Enable WAL mode for better concurrent access
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000'); // 64MB cache
    this.db.pragma('foreign_keys = ON');

    return this.db;
  }

  /**
   * Run database migrations
   */
  migrate(): void {
    const database = this.connect();
    const projectRoot = path.resolve(__dirname, '../..');
    const migrationsDir = path.join(projectRoot, 'migrations');

    // Create migrations tracking table
    database.prepare(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        applied_at TEXT DEFAULT (datetime('now'))
      )
    `).run();

    // Get already applied migrations
    const applied = new Set(
      database
        .prepare('SELECT name FROM _migrations')
        .all()
        .map((r: unknown) => (r as { name: string }).name)
    );

    // Read and sort migration files
    if (!fs.existsSync(migrationsDir)) {
      console.log('No migrations directory found');
      return;
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    // Apply pending migrations
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  ✓ ${file} (already applied)`);
        continue;
      }

      console.log(`  → Applying: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

      // Use exec() for multi-statement SQL files
      database.exec(sql);

      // Record migration
      database.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
      console.log(`  ✓ ${file} applied`);
    }
  }

  /**
   * Get database instance (auto-connects if needed)
   */
  get(): Database.Database {
    return this.connect();
  }

  /**
   * Prepare and return all results
   */
  all<T = unknown>(sql: string, params?: unknown[]): T[] {
    const stmt = this.get().prepare(sql);
    return (params ? stmt.all(...params) : stmt.all()) as T[];
  }

  /**
   * Prepare and return first result
   */
  first<T = unknown>(sql: string, params?: unknown[]): T | undefined {
    const stmt = this.get().prepare(sql);
    return (params ? stmt.get(...params) : stmt.get()) as T | undefined;
  }

  /**
   * Prepare and run a statement (INSERT, UPDATE, DELETE)
   */
  run(sql: string, params?: unknown[]): Database.RunResult {
    const stmt = this.get().prepare(sql);
    return params ? stmt.run(...params) : stmt.run();
  }

  /**
   * Run multiple statements in a transaction
   */
  transaction<T>(fn: () => T): T {
    return this.get().transaction(fn)();
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Get database file path
   */
  getPath(): string {
    return this.config.dbPath;
  }
}

// Singleton instance
export const db = new DatabaseClient();

// Helper to get current ISO timestamp
export function nowISO(): string {
  return new Date().toISOString();
}

// Helper to get hour bucket for signal deduplication
export function getHourBucket(date?: Date): string {
  const d = date || new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}`;
}

// Helper to get day bucket
export function getDayBucket(date?: Date): string {
  const d = date || new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
