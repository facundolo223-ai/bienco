import sqlite3
import os
import secrets
from werkzeug.security import generate_password_hash

DB_PATH = os.environ.get(
    "POSBERRY_DB",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "posberry.db"),
)

VALID_ROLES = ("admin", "empleado", "cajero", "mozo", "cocina")


def get_db_connection():
    conn = sqlite3.connect(DB_PATH, timeout=15, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 8000")
    return conn


def _table_columns(cur, table):
    cur.execute(f"PRAGMA table_info({table})")
    return {row["name"] for row in cur.fetchall()}


def _add_column_if_missing(cur, table, column, ddl):
    if column not in _table_columns(cur, table):
        cur.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


def init_db():
    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            color TEXT DEFAULT '#3B82F6',
            icon TEXT DEFAULT 'tag',
            sort_order INTEGER DEFAULT 0
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE,
            name TEXT NOT NULL,
            category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
            cost_price REAL DEFAULT 0.0,
            sale_price REAL NOT NULL,
            stock REAL DEFAULT 0,
            min_stock REAL DEFAULT 5,
            control_stock INTEGER DEFAULT 1,
            image_url TEXT DEFAULT '',
            is_active INTEGER DEFAULT 1
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS table_sectors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS restaurant_tables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sector_id INTEGER REFERENCES table_sectors(id) ON DELETE CASCADE,
            number TEXT NOT NULL,
            name TEXT,
            capacity INTEGER DEFAULT 4,
            status TEXT DEFAULT 'free',
            active_order_id INTEGER,
            x INTEGER DEFAULT 0,
            y INTEGER DEFAULT 0
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT DEFAULT '',
            email TEXT DEFAULT '',
            address TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            credit_limit REAL DEFAULT 0.0,
            balance REAL DEFAULT 0.0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS customer_ledger (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            balance_after REAL NOT NULL,
            order_id INTEGER,
            notes TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            username TEXT NOT NULL UNIQUE,
            pin_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'cajero',
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            action TEXT NOT NULL,
            entity TEXT DEFAULT '',
            entity_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS cash_shifts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            closed_at TIMESTAMP,
            cashier_name TEXT DEFAULT 'Cajero Principal',
            initial_cash REAL DEFAULT 0.0,
            final_cash_real REAL DEFAULT 0.0,
            final_cash_system REAL DEFAULT 0.0,
            total_sales REAL DEFAULT 0.0,
            total_cash REAL DEFAULT 0.0,
            total_card_debit REAL DEFAULT 0.0,
            total_card_credit REAL DEFAULT 0.0,
            total_transfer REAL DEFAULT 0.0,
            total_customer_credit REAL DEFAULT 0.0,
            difference REAL DEFAULT 0.0,
            notes TEXT DEFAULT '',
            status TEXT DEFAULT 'open',
            opened_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            closed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS cash_movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shift_id INTEGER REFERENCES cash_shifts(id) ON DELETE CASCADE,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            concept TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shift_id INTEGER REFERENCES cash_shifts(id) ON DELETE SET NULL,
            order_type TEXT NOT NULL DEFAULT 'counter',
            table_id INTEGER REFERENCES restaurant_tables(id) ON DELETE SET NULL,
            customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
            customer_name TEXT DEFAULT '',
            customer_phone TEXT DEFAULT '',
            delivery_address TEXT DEFAULT '',
            delivery_notes TEXT DEFAULT '',
            delivery_courier TEXT DEFAULT '',
            delivery_fee REAL DEFAULT 0.0,
            waiter_name TEXT DEFAULT '',
            diners_count INTEGER DEFAULT 1,
            status TEXT DEFAULT 'open',
            subtotal REAL DEFAULT 0.0,
            discount_percent REAL DEFAULT 0.0,
            discount_amount REAL DEFAULT 0.0,
            surcharge_amount REAL DEFAULT 0.0,
            tax_amount REAL DEFAULT 0.0,
            total REAL DEFAULT 0.0,
            payment_method TEXT DEFAULT '',
            amount_paid REAL DEFAULT 0.0,
            change_returned REAL DEFAULT 0.0,
            notes TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            closed_at TIMESTAMP,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            paid_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            channel TEXT DEFAULT 'local',
            external_order_id TEXT DEFAULT ''
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
            product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
            product_name TEXT NOT NULL,
            unit_price REAL NOT NULL,
            quantity REAL NOT NULL DEFAULT 1,
            subtotal REAL NOT NULL,
            notes TEXT DEFAULT '',
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS order_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
            shift_id INTEGER REFERENCES cash_shifts(id) ON DELETE SET NULL,
            method TEXT NOT NULL,
            amount REAL NOT NULL,
            reference TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
        )
    """)

    _add_column_if_missing(cur, "orders", "user_id", "INTEGER")
    _add_column_if_missing(cur, "orders", "paid_by_user_id", "INTEGER")
    _add_column_if_missing(cur, "orders", "channel", "TEXT DEFAULT 'local'")
    _add_column_if_missing(cur, "orders", "external_order_id", "TEXT DEFAULT ''")
    _add_column_if_missing(cur, "cash_shifts", "opened_by_user_id", "INTEGER")
    _add_column_if_missing(cur, "cash_shifts", "closed_by_user_id", "INTEGER")
    _add_column_if_missing(cur, "cash_movements", "user_id", "INTEGER")
    _add_column_if_missing(cur, "order_payments", "user_id", "INTEGER")
    _add_column_if_missing(cur, "products", "image_url", "TEXT DEFAULT ''")

    conn.commit()
    seed_initial_data(conn)
    conn.close()


def ensure_secret_key():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT value FROM config WHERE key = 'secret_key'")
    row = cur.fetchone()
    if row and row["value"]:
        key = row["value"]
    else:
        key = secrets.token_hex(32)
        cur.execute(
            "INSERT INTO config (key, value) VALUES ('secret_key', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key,),
        )
        conn.commit()
    conn.close()
    return key


def seed_initial_data(conn):
    cur = conn.cursor()

    default_config = {
        "business_name": "Bien Correntino",
        "business_subtitle": "Punto de Venta & Sistema Gastronómico",
        "cuit": "30-71987654-3",
        "address": "Av. Corrientes 1520, CABA",
        "phone": "+54 9 11 4455-6677",
        "currency": "$",
        "tax_name": "IVA",
        "tax_percent": "21",
        "ticket_header": "DOCUMENTO NO FISCAL\nTicket de Control / Comanda",
        "ticket_footer": "¡Muchas gracias por su compra!\nEsperamos verle pronto.",
        "enable_tables": "1",
        "enable_delivery": "1",
        "enable_kitchen": "1",
        "enable_stock_alerts": "1",
        "dark_mode": "0",
        "schedule_enabled": "true",
        "schedule_open_time": "19:00",
        "schedule_close_time": "00:30",
        "schedule_days": "lunes,martes,miercoles,jueves,viernes,sabado,domingo",
        "schedule_manual_status": "auto",
        "schedule_closed_message": "En este momento nuestro local se encuentra cerrado. Abrimos a las {open_time} hs.",
    }
    for k, v in default_config.items():
        cur.execute("INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)", (k, v))

    cur.execute("SELECT COUNT(*) FROM users WHERE username = 'admin'")
    if cur.fetchone()[0] == 0:
        cur.execute(
            """
            INSERT INTO users (name, username, pin_hash, role, is_active)
            VALUES (?, ?, ?, ?, 1)
            """,
            ("Dueño / Admin", "admin", generate_password_hash("1234"), "admin"),
        )
    cur.execute("SELECT COUNT(*) FROM users WHERE username = 'empleado'")
    if cur.fetchone()[0] == 0:
        cur.execute(
            """
            INSERT INTO users (name, username, pin_hash, role, is_active)
            VALUES (?, ?, ?, ?, 1)
            """,
            ("Empleado Mostrador", "empleado", generate_password_hash("0000"), "empleado"),
        )
    
    default_employees = [
        ("Ramiro", "ramiro", "1111"),
        ("Nico", "nico", "2222"),
        ("Luciana", "luciana", "3333"),
        ("Romina", "romina", "4444"),
        ("Brisa", "brisa", "5555"),
    ]
    for e_name, e_user, e_pin in default_employees:
        cur.execute("SELECT COUNT(*) FROM users WHERE username = ?", (e_user,))
        if cur.fetchone()[0] == 0:
            cur.execute(
                """
                INSERT INTO users (name, username, pin_hash, role, is_active)
                VALUES (?, ?, ?, 'empleado', 1)
                """,
                (e_name, e_user, generate_password_hash(e_pin)),
            )

    admin_id = None
    cur.execute("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1")
    admin_row = cur.fetchone()
    if admin_row:
        admin_id = admin_row["id"]

    cur.execute("SELECT COUNT(*) FROM categories")
    if cur.fetchone()[0] == 0:
        categories = [
            ("Hamburguesas", "#EF4444", "sandwich", 1),
            ("Pizzas & Empanadas", "#F59E0B", "pizza", 2),
            ("Bebidas & Cervezas", "#3B82F6", "beer", 3),
            ("Cafetería & Desayunos", "#8B5CF6", "coffee", 4),
            ("Almacén / Kiosco", "#10B981", "shopping-bag", 5),
            ("Postres & Dulces", "#EC4899", "ice-cream", 6),
        ]
        cur.executemany(
            "INSERT INTO categories (name, color, icon, sort_order) VALUES (?, ?, ?, ?)",
            categories,
        )

        cur.execute("SELECT id, name FROM categories")
        cat_map = {row["name"]: row["id"] for row in cur.fetchall()}

        products = [
            ("HAM01", "Hamburguesa Clásica con Papas", cat_map["Hamburguesas"], 4200.0, 7800.0, 45, 10, 1),
            ("HAM02", "Doble Cheddar & Bacon Especial", cat_map["Hamburguesas"], 5300.0, 9500.0, 30, 8, 1),
            ("HAM03", "Burger Veggie Criolla con Papas", cat_map["Hamburguesas"], 3800.0, 7200.0, 20, 5, 1),
            ("PIZ01", "Pizza Muzzarella Tradicional (8 Porc.)", cat_map["Pizzas & Empanadas"], 4800.0, 10500.0, 25, 5, 1),
            ("PIZ02", "Pizza Especial Jamón y Morrones", cat_map["Pizzas & Empanadas"], 6000.0, 13000.0, 18, 4, 1),
            ("PIZ03", "Docena de Empanadas Salteñas", cat_map["Pizzas & Empanadas"], 5500.0, 12000.0, 40, 10, 1),
            ("BEB01", "Gaseosa Coca-Cola 500ml", cat_map["Bebidas & Cervezas"], 1100.0, 2200.0, 60, 15, 1),
            ("BEB02", "Gaseosa Coca-Cola 1.5L", cat_map["Bebidas & Cervezas"], 1900.0, 3800.0, 35, 10, 1),
            ("BEB03", "Cerveza Artesanal IPA (Pinta 500cc)", cat_map["Bebidas & Cervezas"], 1800.0, 4200.0, 80, 20, 1),
            ("BEB04", "Cerveza Corona 710ml", cat_map["Bebidas & Cervezas"], 2200.0, 4600.0, 28, 8, 1),
            ("BEB05", "Agua Mineral sin Gas 500ml", cat_map["Bebidas & Cervezas"], 750.0, 1600.0, 50, 12, 1),
            ("CAF01", "Café Expreso / Jarrito", cat_map["Cafetería & Desayunos"], 600.0, 1900.0, 100, 20, 1),
            ("CAF02", "Capuchino Italiano con Canela", cat_map["Cafetería & Desayunos"], 900.0, 2700.0, 50, 15, 1),
            ("CAF03", "Medialunas de Manteca (x3 u.)", cat_map["Cafetería & Desayunos"], 800.0, 2100.0, 35, 10, 1),
            ("CAF04", "Tostado Jamón y Queso en Pan Árabe", cat_map["Cafetería & Desayunos"], 1800.0, 4200.0, 25, 8, 1),
            ("ALM01", "Papas Fritas Lays Clásicas 85g", cat_map["Almacén / Kiosco"], 1100.0, 2300.0, 30, 8, 1),
            ("ALM02", "Chocolate Cofler Block 110g", cat_map["Almacén / Kiosco"], 1400.0, 2900.0, 22, 6, 1),
            ("ALM03", "Chicles Beldent Menta Fuerte", cat_map["Almacén / Kiosco"], 450.0, 950.0, 4, 10, 1),
            ("POS01", "Flan Casero con Mixto (Dulce y Crema)", cat_map["Postres & Dulces"], 1200.0, 3400.0, 15, 5, 1),
            ("POS02", "Copa Helada 2 Sabores Especiales", cat_map["Postres & Dulces"], 1500.0, 3900.0, 20, 5, 1),
        ]
        cur.executemany(
            """
            INSERT INTO products (code, name, category_id, cost_price, sale_price, stock, min_stock, control_stock)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            products,
        )

    cur.execute("SELECT COUNT(*) FROM table_sectors")
    if cur.fetchone()[0] == 0:
        cur.execute("INSERT INTO table_sectors (name, sort_order) VALUES ('Salón Principal', 1)")
        sec_salon = cur.lastrowid
        cur.execute("INSERT INTO table_sectors (name, sort_order) VALUES ('Patio & Terraza', 2)")
        sec_patio = cur.lastrowid
        cur.execute("INSERT INTO table_sectors (name, sort_order) VALUES ('Barra', 3)")
        sec_barra = cur.lastrowid

        tables = [
            (sec_salon, "Mesa 1", "Mesa 1", 2),
            (sec_salon, "Mesa 2", "Mesa 2", 4),
            (sec_salon, "Mesa 3", "Mesa 3", 4),
            (sec_salon, "Mesa 4", "Mesa 4", 6),
            (sec_salon, "Mesa 5", "Mesa 5", 4),
            (sec_salon, "Mesa 6", "Mesa 6", 8),
            (sec_patio, "Mesa 7", "Terraza 7", 4),
            (sec_patio, "Mesa 8", "Terraza 8", 4),
            (sec_patio, "Mesa 9", "Patio 9", 6),
            (sec_patio, "Mesa 10", "Patio 10", 2),
            (sec_barra, "B1", "Barra 1", 1),
            (sec_barra, "B2", "Barra 2", 1),
            (sec_barra, "B3", "Barra 3", 1),
        ]
        cur.executemany(
            "INSERT INTO restaurant_tables (sector_id, number, name, capacity) VALUES (?, ?, ?, ?)",
            tables,
        )

    cur.execute("SELECT COUNT(*) FROM customers")
    if cur.fetchone()[0] == 0:
        customers = [
            ("Juan Pérez", "+54 9 11 2345-6789", "juan.perez@email.com", "Av. San Martín 450, 4to B", "Cliente frecuente, prefiere bien cocido", 50000.0, 0.0),
            ("María Gómez", "+54 9 11 3456-7890", "maria.gomez@email.com", "Calle Belgrano 820", "Timbre 2B, perro amigable", 30000.0, 0.0),
            ("Carlos Rodríguez", "+54 9 11 4567-8901", "carlos.r@email.com", "Pje. Rivadavia 112", "Cuenta corriente autorizada", 80000.0, 14500.0),
        ]
        cur.executemany(
            """
            INSERT INTO customers (name, phone, email, address, notes, credit_limit, balance)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            customers,
        )

    cur.execute("SELECT COUNT(*) FROM cash_shifts WHERE status = 'open'")
    if cur.fetchone()[0] == 0:
        cur.execute(
            """
            INSERT INTO cash_shifts (opened_at, cashier_name, initial_cash, status, opened_by_user_id)
            VALUES (datetime('now', 'localtime'), 'Admin', 25000.0, 'open', ?)
            """,
            (admin_id,),
        )

    conn.commit()
