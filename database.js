const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

class UnicornDatabase {
    constructor() {
        this.db = null;
        this.init();
    }

    init() {
        // Create database file
        const dbPath = path.join(__dirname, 'unicorns.db');
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('❌ Error opening database:', err.message);
            } else {
                console.log('🗄️ Connected to SQLite database');
                this.createTables();
            }
        });
    }

    createTables() {
        // Create tables if they don't exist
        const createUnicornsTable = `
            CREATE TABLE IF NOT EXISTS unicorns (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color_name TEXT NOT NULL,
                color_hex TEXT NOT NULL,
                position_x REAL NOT NULL,
                position_y REAL NOT NULL,
                position_z REAL NOT NULL,
                initial_rotation REAL NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                payment_intent_id TEXT,
                user_session TEXT
            )
        `;

        const createPaymentsTable = `
            CREATE TABLE IF NOT EXISTS payments (
                id TEXT PRIMARY KEY,
                payment_intent_id TEXT UNIQUE NOT NULL,
                base_name TEXT NOT NULL,
                total_unicorns INTEGER NOT NULL,
                total_amount INTEGER NOT NULL,
                currency TEXT NOT NULL,
                status TEXT NOT NULL,
                unicorn_orders TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME,
                user_session TEXT
            )
        `;

        const createStatsTable = `
            CREATE TABLE IF NOT EXISTS stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                total_unicorns INTEGER NOT NULL,
                total_revenue INTEGER NOT NULL,
                space_radius REAL NOT NULL,
                recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;

        this.db.run(createUnicornsTable, (err) => {
            if (err) console.error('❌ Error creating unicorns table:', err);
            else console.log('✅ Unicorns table ready');
        });

        this.db.run(createPaymentsTable, (err) => {
            if (err) console.error('❌ Error creating payments table:', err);
            else console.log('✅ Payments table ready');
        });

        this.db.run(createStatsTable, (err) => {
            if (err) console.error('❌ Error creating stats table:', err);
            else console.log('✅ Stats table ready');
        });
    }

    // Save a single unicorn
    async saveUnicorn(unicornData) {
        return new Promise((resolve, reject) => {
            const {
                name, colorName, colorHex, position, initialRotation,
                paymentIntentId, userSession
            } = unicornData;

            const unicornId = uuidv4();
            const sql = `
                INSERT INTO unicorns (
                    id, name, color_name, color_hex,
                    position_x, position_y, position_z, initial_rotation,
                    payment_intent_id, user_session
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            this.db.run(sql, [
                unicornId, name, colorName, colorHex,
                position.x, position.y, position.z, initialRotation,
                paymentIntentId, userSession
            ], function(err) {
                if (err) {
                    console.error('❌ Error saving unicorn:', err);
                    reject(err);
                } else {
                    console.log(`✅ Unicorn saved: ${name} (${colorName}) - ID: ${unicornId}`);
                    resolve({ id: unicornId, ...unicornData });
                }
            });
        });
    }

    // Save payment record
    async savePayment(paymentData) {
        return new Promise((resolve, reject) => {
            const {
                paymentIntentId, baseName, totalUnicorns, totalAmount,
                currency, status, unicornOrders, userSession
            } = paymentData;

            const sql = `
                INSERT INTO payments (
                    id, payment_intent_id, base_name, total_unicorns,
                    total_amount, currency, status, unicorn_orders, user_session
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            this.db.run(sql, [
                uuidv4(), paymentIntentId, baseName, totalUnicorns,
                totalAmount, currency, status, JSON.stringify(unicornOrders), userSession
            ], function(err) {
                if (err) {
                    console.error('❌ Error saving payment:', err);
                    reject(err);
                } else {
                    console.log(`✅ Payment saved: ${paymentIntentId}`);
                    resolve(paymentData);
                }
            });
        });
    }

    // Get all unicorns
    async getAllUnicorns() {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT * FROM unicorns ORDER BY created_at ASC';
            
            this.db.all(sql, [], (err, rows) => {
                if (err) {
                    console.error('❌ Error fetching unicorns:', err);
                    reject(err);
                } else {
                    console.log(`📊 Loaded ${rows.length} unicorns from database`);
                    resolve(rows);
                }
            });
        });
    }

    // Get unicorns by session (for user-specific loading)
    async getUnicornsBySession(userSession) {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT * FROM unicorns WHERE user_session = ? ORDER BY created_at ASC';
            
            this.db.all(sql, [userSession], (err, rows) => {
                if (err) {
                    console.error('❌ Error fetching user unicorns:', err);
                    reject(err);
                } else {
                    console.log(`📊 Loaded ${rows.length} unicorns for user ${userSession}`);
                    resolve(rows);
                }
            });
        });
    }

    // Update payment status
    async updatePaymentStatus(paymentIntentId, status, completedAt = null) {
        return new Promise((resolve, reject) => {
            const sql = `
                UPDATE payments 
                SET status = ?, completed_at = ? 
                WHERE payment_intent_id = ?
            `;

            this.db.run(sql, [status, completedAt, paymentIntentId], function(err) {
                if (err) {
                    console.error('❌ Error updating payment status:', err);
                    reject(err);
                } else {
                    console.log(`✅ Payment status updated: ${paymentIntentId} → ${status}`);
                    resolve();
                }
            });
        });
    }

    // Get statistics
    async getStats() {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT 
                    COUNT(*) as total_unicorns,
                    SUM(CASE WHEN p.status = 'succeeded' THEN p.total_amount ELSE 0 END) as total_revenue,
                    COUNT(DISTINCT p.user_session) as unique_customers
                FROM unicorns u
                LEFT JOIN payments p ON u.payment_intent_id = p.payment_intent_id
            `;

            this.db.get(sql, [], (err, row) => {
                if (err) {
                    console.error('❌ Error fetching stats:', err);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    // Save space statistics
    async saveSpaceStats(totalUnicorns, totalRevenue, spaceRadius) {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO stats (total_unicorns, total_revenue, space_radius)
                VALUES (?, ?, ?)
            `;

            this.db.run(sql, [totalUnicorns, totalRevenue, spaceRadius], function(err) {
                if (err) {
                    console.error('❌ Error saving stats:', err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    // Close database connection
    close() {
        this.db.close((err) => {
            if (err) {
                console.error('❌ Error closing database:', err);
            } else {
                console.log('🗄️ Database connection closed');
            }
        });
    }
}

module.exports = UnicornDatabase;
