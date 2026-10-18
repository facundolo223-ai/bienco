import os
import json
import sqlite3
import secrets
import random
from datetime import datetime, date
from functools import wraps
from flask import Flask, render_template, request, jsonify, send_file, redirect, url_for
from werkzeug.security import check_password_hash, generate_password_hash
from database import get_db_connection, init_db, DB_PATH

app = Flask(__name__, template_folder="templates", static_folder="static")
app.config["SECRET_KEY"] = "posberry-secret-key-super-secure"

# Asegurar que la base de datos y carpeta de uploads estén inicializadas
init_db()
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "uploads")
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp", "gif"}
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization,X-User-Id,ngrok-skip-browser-warning"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
    response.headers["ngrok-skip-browser-warning"] = "true"
    return response

@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        res = app.make_default_options_response()
        res.headers["Access-Control-Allow-Origin"] = "*"
        res.headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization,X-User-Id"
        res.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
        return res

# ----------------- UTILIDADES Y AUTENTICACIÓN -----------------
def dict_from_row(row):
    return dict(row) if row else None

def get_current_shift(conn):
    cur = conn.cursor()
    cur.execute("SELECT * FROM cash_shifts WHERE status = 'open' ORDER BY id DESC LIMIT 1")
    return cur.fetchone()

def get_system_datetime_info(conn):
    """
    Retorna información sobre la fecha/hora del sistema:
    - mode: 'auto' | 'manual'
    - current_datetime: string 'YYYY-MM-DD HH:MM:SS'
    - date_str: string 'YYYY-MM-DD'
    - time_str: string 'HH:MM:SS'
    """
    cur = conn.cursor()
    cur.execute("SELECT key, value FROM config WHERE key IN ('system_time_mode', 'system_time_custom', 'system_time_set_at')")
    rows = {r["key"]: r["value"] for r in cur.fetchall()}
    mode = rows.get("system_time_mode", "auto")
    
    if mode == "manual" and rows.get("system_time_custom") and rows.get("system_time_set_at"):
        try:
            set_at = datetime.fromisoformat(rows["system_time_set_at"])
            base_dt = datetime.fromisoformat(rows["system_time_custom"])
            elapsed = datetime.now() - set_at
            current_dt = base_dt + elapsed
            return {
                "mode": "manual",
                "current_datetime": current_dt.strftime("%Y-%m-%d %H:%M:%S"),
                "date_str": current_dt.strftime("%Y-%m-%d"),
                "time_str": current_dt.strftime("%H:%M:%S"),
                "iso": current_dt.isoformat()
            }
        except Exception:
            pass

    now = datetime.now()
    return {
        "mode": "auto",
        "current_datetime": now.strftime("%Y-%m-%d %H:%M:%S"),
        "date_str": now.strftime("%Y-%m-%d"),
        "time_str": now.strftime("%H:%M:%S"),
        "iso": now.isoformat()
    }

def get_current_datetime_str(conn):
    return get_system_datetime_info(conn)["current_datetime"]

def get_current_date_str(conn):
    return get_system_datetime_info(conn)["date_str"]

def get_business_hours_status(conn):
    """
    Calcula si el local está ABIERTO o CERRADO según la configuración y la hora actual del sistema.
    """
    cur = conn.cursor()
    cur.execute("""
        SELECT key, value FROM config 
        WHERE key IN (
            'schedule_enabled', 'schedule_open_time', 'schedule_close_time',
            'schedule_days', 'schedule_manual_status', 'schedule_closed_message'
        )
    """)
    cfg = {r["key"]: r["value"] for r in cur.fetchall()}
    
    enabled = cfg.get("schedule_enabled", "true").lower() in ("true", "1", "yes")
    open_time_str = cfg.get("schedule_open_time", "19:00")
    close_time_str = cfg.get("schedule_close_time", "00:30")
    days_str = cfg.get("schedule_days", "lunes,martes,miercoles,jueves,viernes,sabado,domingo")
    manual_status = cfg.get("schedule_manual_status", "auto") # auto | force_open | force_closed
    closed_msg = cfg.get("schedule_closed_message", "En este momento nuestro local se encuentra cerrado. Abrimos a las {open_time} hs.")

    dt_info = get_system_datetime_info(conn)
    current_dt = datetime.fromisoformat(dt_info["iso"])
    current_time_str = current_dt.strftime("%H:%M")
    
    days_map = {
        0: "lunes", 1: "martes", 2: "miercoles", 3: "jueves",
        4: "viernes", 5: "sabado", 6: "domingo"
    }
    current_day = days_map.get(current_dt.weekday(), "lunes")
    allowed_days = [d.strip().lower() for d in days_str.split(",") if d.strip()]

    if manual_status == "force_open":
        is_open = True
        status_label = "Abierto (Manual)"
    elif manual_status == "force_closed":
        is_open = False
        status_label = "Cerrado (Manual)"
    elif not enabled:
        is_open = True
        status_label = "Abierto (Siempre)"
    else:
        is_open = False
        if open_time_str <= close_time_str:
            if current_day in allowed_days and open_time_str <= current_time_str < close_time_str:
                is_open = True
        else:
            # Cruza medianoche (ej. 19:00 a 01:30)
            if current_day in allowed_days and current_time_str >= open_time_str:
                is_open = True
            yesterday_idx = (current_dt.weekday() - 1) % 7
            yesterday_day = days_map.get(yesterday_idx, "domingo")
            if yesterday_day in allowed_days and current_time_str < close_time_str:
                is_open = True
                
        status_label = "Abierto ahora" if is_open else "Cerrado ahora"

    msg = closed_msg.replace("{open_time}", open_time_str).replace("{close_time}", close_time_str)

    return {
        "is_open": is_open,
        "status_label": status_label,
        "enabled": enabled,
        "open_time": open_time_str,
        "close_time": close_time_str,
        "days": days_str,
        "allowed_days_list": allowed_days,
        "manual_status": manual_status,
        "closed_message": msg,
        "current_time": current_time_str,
        "current_day": current_day
    }


def get_authenticated_user(conn):
    """
    Obtiene el usuario autenticado a partir del header X-User-Id o parámetro.
    """
    user_id = request.headers.get("X-User-Id") or request.args.get("auth_user_id")
    if not user_id and request.is_json and request.json:
        user_id = request.json.get("auth_user_id") or request.json.get("user_id")
    if not user_id:
        return None
    cur = conn.cursor()
    cur.execute("SELECT id, name, username, role, is_active FROM users WHERE id = ? AND is_active = 1", (user_id,))
    row = cur.fetchone()
    return dict(row) if row else None

def require_admin(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        conn = get_db_connection()
        user = get_authenticated_user(conn)
        conn.close()
        if not user or user.get("role") != "admin":
            return jsonify({
                "error": "Acceso denegado: Solo el Dueño / Administrador tiene permiso para realizar esta operación."
            }), 403
        return f(*args, **kwargs)
    return decorated_function

# ----------------- RUTAS DE AUTENTICACIÓN Y ROLES -----------------
@app.route("/api/auth/users", methods=["GET"])
def api_auth_users():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, name, username, role FROM users WHERE is_active = 1 ORDER BY id ASC")
    users = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(users)

@app.route("/api/auth/login", methods=["POST"])
def api_auth_login():
    data = request.json or {}
    user_id = data.get("user_id")
    pin = str(data.get("pin", "")).strip()

    if not user_id or not pin:
        return jsonify({"error": "Debe seleccionar un usuario e ingresar su PIN"}), 400

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, name, username, pin_hash, role, is_active FROM users WHERE id = ? AND is_active = 1", (user_id,))
    row = cur.fetchone()
    conn.close()

    if not row:
        return jsonify({"error": "Usuario no encontrado o inactivo"}), 404

    if not check_password_hash(row["pin_hash"], pin):
        return jsonify({"error": "PIN incorrecto"}), 401

    return jsonify({
        "status": "ok",
        "user": {
            "id": row["id"],
            "name": row["name"],
            "username": row["username"],
            "role": row["role"]
        }
    })

@app.route("/api/auth/create_user", methods=["POST"])
@require_admin
def api_auth_create_user():
    data = request.json or {}
    name = data.get("name", "").strip()
    username = data.get("username", "").strip().lower()
    role = data.get("role", "empleado").strip().lower()
    pin = str(data.get("pin", "")).strip()

    if not name or not username or not pin:
        return jsonify({"error": "Nombre, usuario y PIN son obligatorios"}), 400
    if len(pin) < 4:
        return jsonify({"error": "El PIN debe tener al menos 4 dígitos"}), 400

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO users (name, username, pin_hash, role, is_active)
            VALUES (?, ?, ?, ?, 1)
        """, (name, username, generate_password_hash(pin), role))
        conn.commit()
        new_id = cur.lastrowid
        conn.close()
        return jsonify({"status": "ok", "id": new_id, "message": "Usuario creado exitosamente"})
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": f"El nombre de usuario '{username}' ya está en uso"}), 400

@app.route("/api/auth/change_pin", methods=["POST"])
def api_auth_change_pin():
    data = request.json or {}
    user_id = data.get("user_id")
    current_pin = str(data.get("current_pin", "")).strip()
    new_pin = str(data.get("new_pin", "")).strip()
    confirm_pin = str(data.get("confirm_pin", "")).strip()

    if not user_id:
        return jsonify({"error": "Debe seleccionar el usuario"}), 400
    if not current_pin or not new_pin:
        return jsonify({"error": "Debe ingresar el PIN actual y el nuevo PIN"}), 400
    if len(new_pin) < 4:
        return jsonify({"error": "El nuevo PIN debe tener al menos 4 dígitos"}), 400
    if confirm_pin and new_pin != confirm_pin:
        return jsonify({"error": "La confirmación del nuevo PIN no coincide"}), 400

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, name, username, pin_hash, role, is_active FROM users WHERE id = ? AND is_active = 1", (user_id,))
    user = cur.fetchone()

    if not user:
        conn.close()
        return jsonify({"error": "Usuario no encontrado"}), 404

    if not check_password_hash(user["pin_hash"], current_pin):
        conn.close()
        return jsonify({"error": "El PIN actual ingresado es incorrecto"}), 401

    new_hash = generate_password_hash(new_pin)
    cur.execute("UPDATE users SET pin_hash = ? WHERE id = ?", (new_hash, user_id))
    conn.commit()
    conn.close()

    return jsonify({
        "status": "ok",
        "message": f"¡PIN de {user['name']} actualizado exitosamente!"
    })

@app.route("/api/auth/admin_reset_pin", methods=["POST"])
@app.route("/api/auth/users/<int:target_user_id>/set_pin", methods=["POST"])
@require_admin
def api_auth_admin_reset_pin(target_user_id=None):
    data = request.json or {}
    user_id = target_user_id or data.get("user_id")
    new_pin = str(data.get("new_pin") or data.get("pin", "")).strip()

    if not user_id or not new_pin:
        return jsonify({"error": "Debe indicar el usuario y el nuevo PIN"}), 400
    if len(new_pin) < 4:
        return jsonify({"error": "El PIN debe tener al menos 4 dígitos"}), 400

    conn = get_db_connection()
    auth_user = get_authenticated_user(conn)
    cur = conn.cursor()
    cur.execute("SELECT id, name FROM users WHERE id = ?", (user_id,))
    u = cur.fetchone()
    if not u:
        conn.close()
        return jsonify({"error": "Usuario no encontrado"}), 404

    cur.execute("UPDATE users SET pin_hash = ? WHERE id = ?", (generate_password_hash(new_pin), user_id))
    cur.execute("INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (?, 'set_pin', 'users', ?)",
                (auth_user["id"], user_id))
    conn.commit()
    conn.close()

    return jsonify({
        "status": "ok",
        "message": f"¡Nueva clave asignada exitosamente para {u['name']}!"
    })

@app.route("/api/auth/users/<int:target_user_id>", methods=["PUT", "DELETE"])
@require_admin
def api_auth_user_detail(target_user_id):
    conn = get_db_connection()
    auth_user = get_authenticated_user(conn)
    cur = conn.cursor()

    if target_user_id == 1 and request.method == "DELETE":
        conn.close()
        return jsonify({"error": "No se puede eliminar la cuenta del Administrador principal"}), 400

    if request.method == "DELETE":
        cur.execute("UPDATE users SET is_active = 0 WHERE id = ?", (target_user_id,))
        cur.execute("INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (?, 'deactivate_user', 'users', ?)",
                    (auth_user["id"], target_user_id))
        conn.commit()
        conn.close()
        return jsonify({"status": "ok", "message": "Empleado desactivado exitosamente"})

    data = request.json or {}
    name = data.get("name")
    role = data.get("role")
    updates = []
    params = []
    if name:
        updates.append("name = ?")
        params.append(name.strip())
    if role and role in ("admin", "empleado", "cajero"):
        updates.append("role = ?")
        params.append(role)
    if not updates:
        conn.close()
        return jsonify({"error": "No se especificaron cambios"}), 400

    params.append(target_user_id)
    cur.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
    conn.commit()
    conn.close()
    return jsonify({"status": "ok", "message": "Usuario actualizado exitosamente"})


# ----------------- VISTA PRINCIPAL -----------------
@app.route("/")
def index():
    return render_template("index.html")

# ----------------- API CONFIGURACIÓN -----------------
@app.route("/api/config", methods=["GET", "POST"])
def api_config():
    conn = get_db_connection()
    cur = conn.cursor()
    if request.method == "POST":
        user = get_authenticated_user(conn)
        if not user or user.get("role") != "admin":
            conn.close()
            return jsonify({"error": "Acceso denegado: Solo el Dueño/Administrador puede modificar la configuración"}), 403
        data = request.json or {}
        for k, v in data.items():
            cur.execute("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(k), str(v)))
        conn.commit()
        conn.close()
        return jsonify({"status": "ok", "message": "Configuración guardada exitosamente"})
    
    cur.execute("SELECT key, value FROM config")
    rows = cur.fetchall()
    config_dict = {r["key"]: r["value"] for r in rows}
    conn.close()
    return jsonify(config_dict)

@app.route("/api/config/datetime", methods=["GET", "POST"])
def api_config_datetime():
    conn = get_db_connection()
    if request.method == "GET":
        info = get_system_datetime_info(conn)
        conn.close()
        return jsonify(info)

    user = get_authenticated_user(conn)
    if not user or user.get("role") != "admin":
        conn.close()
        return jsonify({"error": "Acceso denegado: Solo el Dueño / Administrador puede modificar la fecha y hora del sistema"}), 403

    data = request.json or {}
    mode = data.get("mode", "auto")
    cur = conn.cursor()

    if mode == "manual":
        dt_val = (data.get("datetime") or "").strip().replace("T", " ")
        if len(dt_val) == 16:
            dt_val += ":00"
        try:
            datetime.fromisoformat(dt_val)
        except Exception:
            conn.close()
            return jsonify({"error": "Formato de fecha u hora no válido (debe ser AAAA-MM-DD HH:MM:SS)"}), 400

        cur.execute("INSERT INTO config (key, value) VALUES ('system_time_mode', 'manual') ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        cur.execute("INSERT INTO config (key, value) VALUES ('system_time_custom', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (dt_val,))
        cur.execute("INSERT INTO config (key, value) VALUES ('system_time_set_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (datetime.now().isoformat(),))
    else:
        cur.execute("INSERT INTO config (key, value) VALUES ('system_time_mode', 'auto') ON CONFLICT(key) DO UPDATE SET value=excluded.value")

    cur.execute("INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (?, 'change_system_time', 'config', NULL)", (user["id"],))
    conn.commit()
    info = get_system_datetime_info(conn)
    conn.close()
    return jsonify({"status": "ok", "message": "Fecha y hora del sistema actualizadas exitosamente", "info": info})
# ----------------- API HORARIOS DE ATENCIÓN (APERTURA Y CIERRE) -----------------
@app.route("/api/schedule", methods=["GET", "POST"])
def api_schedule():
    conn = get_db_connection()
    if request.method == "POST":
        user = get_authenticated_user(conn)
        if not user:
            conn.close()
            return jsonify({"error": "No autorizado: Ingrese como personal o dueño para modificar los horarios."}), 403
            
        data = request.json or {}
        cur = conn.cursor()
        
        fields = [
            ("schedule_enabled", str(data.get("enabled", "true")).lower()),
            ("schedule_open_time", str(data.get("open_time", "19:00")).strip()),
            ("schedule_close_time", str(data.get("close_time", "00:30")).strip()),
            ("schedule_days", str(data.get("days", "lunes,martes,miercoles,jueves,viernes,sabado,domingo")).strip()),
            ("schedule_manual_status", str(data.get("manual_status", "auto")).strip()),
            ("schedule_closed_message", str(data.get("closed_message", "En este momento nuestro local se encuentra cerrado. Abrimos a las {open_time} hs.")).strip()),
        ]
        
        for k, v in fields:
            cur.execute("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (k, v))
            
        cur.execute("INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (?, 'update_schedule', 'config', NULL)", (user["id"],))
        conn.commit()
        
        status_info = get_business_hours_status(conn)
        conn.close()
        return jsonify({"status": "ok", "message": "Horarios guardados exitosamente", "schedule": status_info})

    # GET público
    status_info = get_business_hours_status(conn)
    conn.close()
    return jsonify(status_info)


# ----------------- API CATEGORÍAS -----------------
@app.route("/api/categories", methods=["GET", "POST"])
def api_categories():
    conn = get_db_connection()
    cur = conn.cursor()
    if request.method == "POST":
        user = get_authenticated_user(conn)
        if not user or user.get("role") != "admin":
            conn.close()
            return jsonify({"error": "Acceso denegado: Solo el Dueño/Administrador puede crear categorías"}), 403
        data = request.json
        name = data.get("name", "").strip()
        color = data.get("color", "#3B82F6")
        icon = data.get("icon", "tag")
        sort_order = int(data.get("sort_order", 0))
        if not name:
            conn.close()
            return jsonify({"error": "El nombre es obligatorio"}), 400
        cur.execute("INSERT INTO categories (name, color, icon, sort_order) VALUES (?, ?, ?, ?)", (name, color, icon, sort_order))
        conn.commit()
        new_id = cur.lastrowid
        conn.close()
        return jsonify({"status": "ok", "id": new_id, "message": "Categoría creada"})

    cur.execute("SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_active = 1) as product_count FROM categories c ORDER BY c.sort_order ASC, c.name ASC")
    cats = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(cats)

@app.route("/api/categories/<int:cat_id>", methods=["PUT", "DELETE"])
def api_category_detail(cat_id):
    conn = get_db_connection()
    user = get_authenticated_user(conn)
    if not user or user.get("role") != "admin":
        conn.close()
        return jsonify({"error": "Acceso denegado: Solo el Dueño/Administrador puede modificar o eliminar categorías"}), 403
    cur = conn.cursor()
    if request.method == "DELETE":
        cur.execute("UPDATE products SET category_id = NULL WHERE category_id = ?", (cat_id,))
        cur.execute("DELETE FROM categories WHERE id = ?", (cat_id,))
        conn.commit()
        conn.close()
        return jsonify({"status": "ok", "message": "Categoría eliminada"})
    
    data = request.json
    cur.execute("""
        UPDATE categories SET name = ?, color = ?, icon = ?, sort_order = ?
        WHERE id = ?
    """, (data.get("name"), data.get("color"), data.get("icon"), data.get("sort_order", 0), cat_id))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok", "message": "Categoría actualizada"})

# ----------------- API PRODUCTOS -----------------
@app.route("/api/products", methods=["GET", "POST"])
def api_products():
    conn = get_db_connection()
    cur = conn.cursor()
    if request.method == "POST":
        user = get_authenticated_user(conn)
        if not user:
            conn.close()
            return jsonify({"error": "Acceso denegado: Debe iniciar sesión para crear productos"}), 403
        data = request.json or {}
        name = data.get("name", "").strip()
        code = data.get("code", "").strip()
        cat_id = data.get("category_id") or None
        cost_price = float(data.get("cost_price") or 0)
        sale_price = float(data.get("sale_price") or 0)
        stock = float(data.get("stock") or 0)
        min_stock = float(data.get("min_stock") or 5)
        control_stock = 1 if data.get("control_stock") else 0
        image_url = data.get("image_url", "").strip()

        if not name:
            conn.close()
            return jsonify({"error": "El nombre es obligatorio"}), 400
        
        # Generar código automático si no se ingresó
        if not code:
            cur.execute("SELECT MAX(id) FROM products")
            max_id = (cur.fetchone()[0] or 0) + 1
            code = f"PROD{max_id:04d}"

        try:
            cur.execute("""
                INSERT INTO products (code, name, category_id, cost_price, sale_price, stock, min_stock, control_stock, image_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (code, name, cat_id, cost_price, sale_price, stock, min_stock, control_stock, image_url))
            conn.commit()
            new_id = cur.lastrowid
            conn.close()
            return jsonify({"status": "ok", "id": new_id, "message": "Producto creado"})
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({"error": f"Ya existe un producto con el código '{code}'"}), 400

    q = request.args.get("q", "").strip().lower()
    cat_filter = request.args.get("category_id")
    low_stock = request.args.get("low_stock")

    sql = """
        SELECT p.*, c.name as category_name, c.color as category_color
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.is_active = 1
    """
    params = []
    if q:
        sql += " AND (LOWER(p.name) LIKE ? OR LOWER(p.code) LIKE ?)"
        params.extend([f"%{q}%", f"%{q}%"])
    if cat_filter:
        sql += " AND p.category_id = ?"
        params.append(cat_filter)
    if low_stock == "1":
        sql += " AND p.control_stock = 1 AND p.stock <= p.min_stock"
    
    sql += " ORDER BY p.name ASC"
    cur.execute(sql, params)
    prods = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(prods)

@app.route("/api/products/<int:prod_id>", methods=["PUT", "DELETE"])
def api_product_detail(prod_id):
    conn = get_db_connection()
    cur = conn.cursor()
    if request.method == "DELETE":
        user = get_authenticated_user(conn)
        if user and user.get("role") == "empleado":
            conn.close()
            return jsonify({"error": "Acceso denegado: Los empleados no tienen permitido eliminar productos"}), 403

        cur.execute("""
            UPDATE products SET 
                is_active = 0,
                code = CASE 
                    WHEN code IS NOT NULL AND code != '' 
                    THEN code || '_del_' || cast(strftime('%s', 'now') as text)
                    ELSE code 
                END
            WHERE id = ?
        """, (prod_id,))
        user_id = user["id"] if user else 1
        cur.execute("INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (?, 'delete_product', 'products', ?)",
                    (user_id, prod_id))
        conn.commit()
        conn.close()
        return jsonify({"status": "ok", "message": "Producto eliminado exitosamente"})

    # Bloque PUT
    user = get_authenticated_user(conn)
    if not user:
        conn.close()
        return jsonify({"error": "Acceso denegado: Debe iniciar sesión para modificar productos"}), 403
    data = request.json or {}
    try:
        cur.execute("""
            UPDATE products SET
                code = ?, name = ?, category_id = ?, cost_price = ?,
                sale_price = ?, stock = ?, min_stock = ?, control_stock = ?,
                image_url = ?
            WHERE id = ?
        """, (
            data.get("code"), data.get("name"), data.get("category_id") or None,
            float(data.get("cost_price") or 0), float(data.get("sale_price") or 0),
            float(data.get("stock") or 0), float(data.get("min_stock") or 5),
            1 if data.get("control_stock") else 0, data.get("image_url", ""), prod_id
        ))
        conn.commit()
        conn.close()
        return jsonify({"status": "ok", "message": "Producto actualizado"})
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": "El código ingresado ya pertenece a otro producto"}), 400

@app.route("/api/products/<int:prod_id>/photo", methods=["POST"])
@app.route("/api/products/<int:prod_id>/image", methods=["POST"])
def api_product_set_photo(prod_id):
    import uuid, time, base64
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, name FROM products WHERE id = ?", (prod_id,))
    prod = cur.fetchone()
    if not prod:
        conn.close()
        return jsonify({"error": "Producto no encontrado"}), 404

    user = get_authenticated_user(conn)
    if not user:
        conn.close()
        return jsonify({"error": "Acceso denegado: Debe iniciar sesión para modificar fotos de productos"}), 403

    image_url = None

    # Caso 1: Archivo subido (multipart/form-data)
    if "file" in request.files:
        file = request.files["file"]
        if file and file.filename != "":
            if not allowed_file(file.filename):
                conn.close()
                return jsonify({"error": "Formato no permitido. Utilice JPG, PNG, WEBP o GIF"}), 400
            ext = file.filename.rsplit(".", 1)[1].lower()
            filename = f"prod_{prod_id}_{int(time.time())}_{uuid.uuid4().hex[:6]}.{ext}"
            os.makedirs(UPLOAD_FOLDER, exist_ok=True)
            filepath = os.path.join(UPLOAD_FOLDER, filename)
            file.save(filepath)
            image_url = f"/static/uploads/{filename}"

    # Caso 2: JSON con base64 o image_url
    if not image_url and request.is_json:
        data = request.json or {}
        image_base64 = data.get("image_base64", "")
        if image_base64 and image_base64.startswith("data:image/"):
            try:
                header, encoded = image_base64.split(",", 1)
                ext = "png"
                if "jpeg" in header or "jpg" in header:
                    ext = "jpg"
                elif "webp" in header:
                    ext = "webp"
                elif "gif" in header:
                    ext = "gif"
                filename = f"prod_{prod_id}_{int(time.time())}_{uuid.uuid4().hex[:6]}.{ext}"
                os.makedirs(UPLOAD_FOLDER, exist_ok=True)
                filepath = os.path.join(UPLOAD_FOLDER, filename)
                with open(filepath, "wb") as fh:
                    fh.write(base64.b64decode(encoded))
                image_url = f"/static/uploads/{filename}"
            except Exception as e:
                conn.close()
                return jsonify({"error": f"Error decodificando imagen: {str(e)}"}), 400
        elif "image_url" in data:
            image_url = data.get("image_url", "").strip()

    if image_url is None and request.form.get("image_url") is not None:
        image_url = request.form.get("image_url", "").strip()

    if image_url is None:
        conn.close()
        return jsonify({"error": "No se recibió ninguna imagen válida"}), 400

    cur.execute("UPDATE products SET image_url = ? WHERE id = ?", (image_url, prod_id))
    conn.commit()
    conn.close()
    return jsonify({
        "status": "ok",
        "product_id": prod_id,
        "image_url": image_url,
        "message": f"Foto de {prod['name']} guardada correctamente"
    })

@app.route("/api/products/<int:prod_id>/stock", methods=["POST"])
def api_product_stock_adjust(prod_id):
    conn = get_db_connection()
    user = get_authenticated_user(conn)
    if not user or user.get("role") != "admin":
        conn.close()
        return jsonify({"error": "Acceso denegado: Los empleados no pueden ajustar el stock manualmente"}), 403

    data = request.json
    delta = float(data.get("delta", 0))
    cur = conn.cursor()
    cur.execute("UPDATE products SET stock = stock + ? WHERE id = ?", (delta, prod_id))
    cur.execute("SELECT stock FROM products WHERE id = ?", (prod_id,))
    new_stock = cur.fetchone()["stock"]
    conn.commit()
    conn.close()
    return jsonify({"status": "ok", "new_stock": new_stock})

# ----------------- CARGA DE FOTOS DE PRODUCTOS Y PROMOCIONES -----------------
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "uploads")
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp", "gif"}

def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route("/api/upload/image", methods=["POST"])
def api_upload_image():
    import uuid, time, base64
    conn = get_db_connection()
    user = get_authenticated_user(conn)
    conn.close()
    if not user:
        return jsonify({"error": "Acceso denegado: Debe iniciar sesión para subir imágenes"}), 403

    os.makedirs(UPLOAD_FOLDER, exist_ok=True)

    # 1. Caso multipart/form-data (archivo enviado directamente)
    if "file" in request.files:
        file = request.files["file"]
        if not file or file.filename == "":
            return jsonify({"error": "No se seleccionó ningún archivo"}), 400
        if not allowed_file(file.filename):
            return jsonify({"error": "Formato no permitido. Utilice JPG, PNG, WEBP o GIF"}), 400
        ext = file.filename.rsplit(".", 1)[1].lower()
        filename = f"prod_{int(time.time())}_{uuid.uuid4().hex[:8]}.{ext}"
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        file.save(filepath)
        return jsonify({"status": "ok", "url": f"/static/uploads/{filename}"})

    # 2. Caso JSON con base64 o URL directa
    if request.is_json:
        data = request.json or {}
        image_data = data.get("image_base64", "")
        if image_data and image_data.startswith("data:image/"):
            try:
                header, encoded = image_data.split(",", 1)
                ext = "png"
                if "jpeg" in header or "jpg" in header:
                    ext = "jpg"
                elif "webp" in header:
                    ext = "webp"
                elif "gif" in header:
                    ext = "gif"
                filename = f"prod_{int(time.time())}_{uuid.uuid4().hex[:8]}.{ext}"
                filepath = os.path.join(UPLOAD_FOLDER, filename)
                with open(filepath, "wb") as fh:
                    fh.write(base64.b64decode(encoded))
                return jsonify({"status": "ok", "url": f"/static/uploads/{filename}"})
            except Exception as e:
                return jsonify({"error": f"Error decodificando imagen: {str(e)}"}), 400
        elif data.get("image_url"):
            return jsonify({"status": "ok", "url": data.get("image_url").strip()})

    return jsonify({"error": "No se recibió ninguna imagen válida"}), 400

# ----------------- API MESAS Y SALÓN -----------------
@app.route("/api/tables", methods=["GET", "POST"])
def api_tables():
    conn = get_db_connection()
    cur = conn.cursor()

    if request.method == "POST":
        data = request.json
        sector_id = data.get("sector_id")
        number = data.get("number")
        name = data.get("name") or number
        capacity = int(data.get("capacity", 4))
        cur.execute("INSERT INTO restaurant_tables (sector_id, number, name, capacity) VALUES (?, ?, ?, ?)", (sector_id, number, name, capacity))
        conn.commit()
        new_id = cur.lastrowid
        conn.close()
        return jsonify({"status": "ok", "id": new_id})

    # Listar sectores con mesas
    cur.execute("SELECT * FROM table_sectors ORDER BY sort_order ASC, name ASC")
    sectors = [dict(s) for s in cur.fetchall()]

    for s in sectors:
        cur.execute("""
            SELECT t.*, o.id as order_id, o.waiter_name, o.diners_count, o.total as order_total,
                   o.created_at as order_created_at
            FROM restaurant_tables t
            LEFT JOIN orders o ON t.active_order_id = o.id AND o.status IN ('open', 'kitchen')
            WHERE t.sector_id = ?
            ORDER BY t.id ASC
        """, (s["id"],))
        tables_list = []
        for r in cur.fetchall():
            td = dict(r)
            if td["order_id"]:
                # Traer items de la orden
                cur.execute("SELECT COUNT(*) as item_count, SUM(subtotal) as current_total FROM order_items WHERE order_id = ?", (td["order_id"],))
                it_info = cur.fetchone()
                td["item_count"] = it_info["item_count"] or 0
                td["order_total"] = it_info["current_total"] or 0.0
            else:
                td["item_count"] = 0
                td["order_total"] = 0.0
            tables_list.append(td)
        s["tables"] = tables_list

    conn.close()
    return jsonify(sectors)

@app.route("/api/tables/<int:table_id>/open", methods=["POST"])
def api_table_open(table_id):
    conn = get_db_connection()
    cur = conn.cursor()
    data = request.json or {}
    waiter = data.get("waiter_name", "Mozo").strip()
    diners = int(data.get("diners_count", 2))

    shift = get_current_shift(conn)
    shift_id = shift["id"] if shift else None

    # Crear orden de mesa
    cur.execute("""
        INSERT INTO orders (shift_id, order_type, table_id, waiter_name, diners_count, status, subtotal, total)
        VALUES (?, 'table', ?, ?, ?, 'open', 0, 0)
    """, (shift_id, table_id, waiter, diners))
    order_id = cur.lastrowid

    # Actualizar estado de mesa
    cur.execute("UPDATE restaurant_tables SET status = 'busy', active_order_id = ? WHERE id = ?", (order_id, table_id))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok", "order_id": order_id, "message": "Mesa abierta exitosamente"})

@app.route("/api/tables/<int:table_id>/order", methods=["GET"])
def api_table_get_order(table_id):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT active_order_id, status, number, name, capacity FROM restaurant_tables WHERE id = ?", (table_id,))
    t = cur.fetchone()
    if not t or not t["active_order_id"]:
        conn.close()
        return jsonify({"order": None, "table": dict(t) if t else None})
    
    order_id = t["active_order_id"]
    cur.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
    order = dict(cur.fetchone())

    cur.execute("SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC", (order_id,))
    order["items"] = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify({"order": order, "table": dict(t)})

@app.route("/api/tables/<int:table_id>/add_items", methods=["POST"])
def api_table_add_items(table_id):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT active_order_id FROM restaurant_tables WHERE id = ?", (table_id,))
    t = cur.fetchone()
    if not t or not t["active_order_id"]:
        conn.close()
        return jsonify({"error": "La mesa no tiene una comanda abierta"}), 400

    order_id = t["active_order_id"]
    data = request.json
    items = data.get("items", [])

    for item in items:
        p_id = item.get("product_id")
        p_name = item.get("name")
        p_price = float(item.get("sale_price", item.get("price", 0)))
        p_qty = float(item.get("quantity", 1))
        p_notes = item.get("notes", "")
        p_subtotal = p_price * p_qty

        cur.execute("""
            INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, notes, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
        """, (order_id, p_id, p_name, p_price, p_qty, p_subtotal, p_notes))

        # Descontar stock si corresponde
        if p_id:
            cur.execute("""
                UPDATE products SET stock = stock - ?
                WHERE id = ? AND control_stock = 1
            """, (p_qty, p_id))

    # Recalcular totales de orden
    cur.execute("SELECT SUM(subtotal) as subtotal FROM order_items WHERE order_id = ?", (order_id,))
    subtotal = cur.fetchone()["subtotal"] or 0.0
    cur.execute("UPDATE orders SET subtotal = ?, total = ?, updated_at = datetime('now', 'localtime') WHERE id = ?", (subtotal, subtotal, order_id))
    cur.execute("UPDATE restaurant_tables SET status = 'busy' WHERE id = ?", (table_id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok", "subtotal": subtotal, "message": "Items agregados a la comanda"})

@app.route("/api/tables/<int:table_id>/bill", methods=["POST"])
def api_table_bill(table_id):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("UPDATE restaurant_tables SET status = 'billing' WHERE id = ?", (table_id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok", "message": "Mesa en estado: Cuenta Pedida"})

@app.route("/api/tables/<int:table_id>/transfer", methods=["POST"])
def api_table_transfer(table_id):
    conn = get_db_connection()
    cur = conn.cursor()
    data = request.json
    target_table_id = data.get("target_table_id")

    cur.execute("SELECT active_order_id FROM restaurant_tables WHERE id = ?", (table_id,))
    t_source = cur.fetchone()
    cur.execute("SELECT status, active_order_id FROM restaurant_tables WHERE id = ?", (target_table_id,))
    t_target = cur.fetchone()

    if not t_source or not t_source["active_order_id"]:
        conn.close()
        return jsonify({"error": "La mesa de origen no tiene una orden activa"}), 400
    if not t_target or t_target["status"] != "free":
        conn.close()
        return jsonify({"error": "La mesa de destino debe estar libre"}), 400

    order_id = t_source["active_order_id"]
    cur.execute("UPDATE orders SET table_id = ? WHERE id = ?", (target_table_id, order_id))
    cur.execute("UPDATE restaurant_tables SET status = 'busy', active_order_id = ? WHERE id = ?", (order_id, target_table_id))
    cur.execute("UPDATE restaurant_tables SET status = 'free', active_order_id = NULL WHERE id = ?", (table_id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok", "message": "Comanda transferida exitosamente"})

# ----------------- API CHECKOUT / COBRO GENERAL (POS, MESAS, DELIVERY) -----------------
@app.route("/api/checkout", methods=["POST"])
def api_checkout():
    conn = get_db_connection()
    cur = conn.cursor()
    data = request.json or {}

    order_type = data.get("order_type", "counter")
    items = data.get("items", [])
    table_id = data.get("table_id")
    order_id = data.get("order_id") # Si ya existía (mesa o delivery previo)
    customer_id = data.get("customer_id")
    customer_name = data.get("customer_name", "").strip()
    customer_phone = data.get("customer_phone", "").strip()
    delivery_address = data.get("delivery_address", "").strip()
    delivery_courier = data.get("delivery_courier", "").strip()
    delivery_notes = data.get("delivery_notes", "").strip()
    delivery_fee = float(data.get("delivery_fee") or 0)
    
    subtotal = float(data.get("subtotal") or 0)
    discount_percent = float(data.get("discount_percent") or 0)
    discount_amount = float(data.get("discount_amount") or 0)
    surcharge_amount = float(data.get("surcharge_amount") or 0)
    total = float(data.get("total") or 0)
    payment_method = data.get("payment_method", "cash")
    amount_paid = float(data.get("amount_paid") or total)
    change_returned = float(data.get("change_returned") or 0)
    notes = data.get("notes", "").strip()

    shift = get_current_shift(conn)
    shift_id = shift["id"] if shift else None

    # Identificar al cajero/usuario
    auth_user = get_authenticated_user(conn)
    user_id = (auth_user["id"] if auth_user else None) or data.get("user_id")

    sys_dt = get_current_datetime_str(conn)

    # Si es una orden nueva (ej: mostrador o delivery creado al momento)
    if not order_id:
        cur.execute("""
            INSERT INTO orders (
                shift_id, order_type, table_id, customer_id, customer_name, customer_phone,
                delivery_address, delivery_notes, delivery_courier, delivery_fee,
                status, subtotal, discount_percent, discount_amount, surcharge_amount,
                total, payment_method, amount_paid, change_returned, notes,
                created_at, closed_at, updated_at,
                user_id, paid_by_user_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            shift_id, order_type, table_id, customer_id, customer_name, customer_phone,
            delivery_address, delivery_notes, delivery_courier, delivery_fee,
            subtotal, discount_percent, discount_amount, surcharge_amount,
            total, payment_method, amount_paid, change_returned, notes,
            sys_dt, sys_dt, sys_dt,
            user_id, user_id
        ))
        order_id = cur.lastrowid

        # Insertar items y descontar stock
        for it in items:
            p_id = it.get("product_id") or it.get("id")
            p_name = it.get("name") or it.get("product_name") or "Producto"
            p_price = float(it.get("price") or it.get("sale_price") or it.get("unit_price") or 0)
            p_qty = float(it.get("quantity") or 1)
            p_sub = float(it.get("subtotal") or (p_price * p_qty))
            p_note = it.get("notes", "")

            cur.execute("""
                INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, notes, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'served', ?)
            """, (order_id, p_id, p_name, p_price, p_qty, p_sub, p_note, sys_dt))

            if p_id:
                cur.execute("""
                    UPDATE products SET stock = stock - ?
                    WHERE id = ? AND control_stock = 1
                """, (p_qty, p_id))

    else:
        # Orden existente (mesa que se cobra o delivery)
        cur.execute("""
            UPDATE orders SET
                status = 'paid',
                subtotal = ?,
                discount_percent = ?,
                discount_amount = ?,
                surcharge_amount = ?,
                total = ?,
                payment_method = ?,
                amount_paid = ?,
                change_returned = ?,
                notes = ?,
                closed_at = ?,
                updated_at = ?,
                paid_by_user_id = ?
            WHERE id = ?
        """, (subtotal, discount_percent, discount_amount, surcharge_amount, total, payment_method, amount_paid, change_returned, notes, sys_dt, sys_dt, user_id, order_id))

    # Pagos individuales (para desglose)
    payments = data.get("payments", [])
    if not payments:
        payments = [{"method": payment_method, "amount": total}]
    
    for pay in payments:
        m = pay.get("method", "cash")
        a = float(pay.get("amount", total))
        ref = pay.get("reference", "")
        cur.execute("INSERT INTO order_payments (order_id, shift_id, method, amount, reference, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", (order_id, shift_id, m, a, ref, user_id, sys_dt))


        # Si el pago fue a 'credit' (cuenta corriente del cliente)
        if m == "credit" and customer_id:
            cur.execute("SELECT balance FROM customers WHERE id = ?", (customer_id,))
            c_row = cur.fetchone()
            current_bal = c_row["balance"] if c_row else 0.0
            new_bal = current_bal + a
            cur.execute("UPDATE customers SET balance = ? WHERE id = ?", (new_bal, customer_id))
            cur.execute("""
                INSERT INTO customer_ledger (customer_id, type, amount, balance_after, order_id, notes)
                VALUES (?, 'charge', ?, ?, ?, 'Compra fiada Ticket #' || ?)
            """, (customer_id, a, new_bal, order_id, order_id))

    # Si provenía de una mesa, liberar la mesa
    if table_id:
        cur.execute("UPDATE restaurant_tables SET status = 'free', active_order_id = NULL WHERE id = ?", (table_id,))

    conn.commit()

    # Traer la orden completa para comprobante
    cur.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
    saved_order = dict(cur.fetchone())
    cur.execute("SELECT * FROM order_items WHERE order_id = ?", (order_id,))
    saved_order["items"] = [dict(r) for r in cur.fetchall()]
    cur.execute("SELECT * FROM order_payments WHERE order_id = ?", (order_id,))
    saved_order["payments"] = [dict(r) for r in cur.fetchall()]

    conn.close()
    return jsonify({"status": "ok", "order": saved_order, "message": "Venta procesada exitosamente"})

# ----------------- API MONITOR DE COCINA (KDS) -----------------
@app.route("/api/kitchen", methods=["GET"])
def api_kitchen():
    conn = get_db_connection()
    cur = conn.cursor()
    
    # Comandas activas en preparación (pendientes o cocinando)
    cur.execute("""
        SELECT o.id, o.order_type, o.table_id, o.waiter_name, o.customer_name, o.customer_phone,
               o.delivery_address, o.payment_method, o.notes as order_notes,
               o.created_at, t.number as table_number, t.name as table_name
        FROM orders o
        LEFT JOIN restaurant_tables t ON o.table_id = t.id
        WHERE o.status IN ('open', 'kitchen')
        ORDER BY o.created_at ASC
    """)
    orders = [dict(r) for r in cur.fetchall()]

    active_orders = []
    for ord_dict in orders:
        cur.execute("""
            SELECT id, product_name, quantity, notes, status
            FROM order_items
            WHERE order_id = ? AND status IN ('pending', 'cooking')
            ORDER BY id ASC
        """, (ord_dict["id"],))
        items = [dict(i) for i in cur.fetchall()]
        if items:
            ord_dict["items"] = items
            active_orders.append(ord_dict)

    conn.close()
    return jsonify(active_orders)

@app.route("/api/kitchen/item/<int:item_id>/status", methods=["POST"])
def api_kitchen_item_status(item_id):
    conn = get_db_connection()
    cur = conn.cursor()
    new_status = request.json.get("status", "ready")
    cur.execute("UPDATE order_items SET status = ? WHERE id = ?", (new_status, item_id))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok", "new_status": new_status})

@app.route("/api/kitchen/order/<int:order_id>/ready", methods=["POST"])
def api_kitchen_order_ready(order_id):
    conn = get_db_connection()
    cur = conn.cursor()
    sys_dt = get_current_datetime_str(conn)
    cur.execute("UPDATE order_items SET status = 'ready' WHERE order_id = ? AND status != 'served'", (order_id,))
    cur.execute("UPDATE orders SET status = 'ready', updated_at = ? WHERE id = ?", (sys_dt, order_id))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok", "message": "Comanda completada"})

# ----------------- API ESTADO DE PEDIDOS EN VIVO (CLIENTES Y MOSTRADOR) -----------------
@app.route("/api/orders/live_status", methods=["GET"])
def api_orders_live_status():
    conn = get_db_connection()
    cur = conn.cursor()
    
    # Consultar pedidos de hoy con estado 'open', 'kitchen' o 'ready'
    cur.execute("""
        SELECT id, order_type, table_id, customer_name, customer_phone,
               delivery_address, delivery_notes, delivery_courier, delivery_fee,
               status, subtotal, total, payment_method, channel, external_order_id,
               created_at, updated_at
        FROM orders
        WHERE status IN ('open', 'kitchen', 'ready')
          AND date(created_at) = date('now', 'localtime')
        ORDER BY id DESC
    """)
    rows = [dict(r) for r in cur.fetchall()]
    
    in_process = []
    ready = []
    
    for ord_dict in rows:
        cur.execute("""
            SELECT id, product_id, product_name, unit_price, quantity, subtotal, notes, status
            FROM order_items
            WHERE order_id = ?
        """, (ord_dict["id"],))
        ord_dict["items"] = [dict(it) for it in cur.fetchall()]
        
        if ord_dict["status"] in ("open", "kitchen"):
            in_process.append(ord_dict)
        elif ord_dict["status"] == "ready":
            ready.append(ord_dict)
            
    conn.close()
    return jsonify({
        "status": "ok",
        "in_process": in_process,
        "ready": ready,
        "counts": {
            "in_process": len(in_process),
            "ready": len(ready)
        }
    })

# ----------------- API DELIVERY & TAKE AWAY -----------------
@app.route("/api/delivery", methods=["GET", "POST"])
def api_delivery():
    conn = get_db_connection()
    cur = conn.cursor()

    if request.method == "POST":
        data = request.json or {}
        shift = get_current_shift(conn)
        shift_id = shift["id"] if shift else None
        sys_dt = get_current_datetime_str(conn)

        items = data.get("items", [])
        subtotal = float(data.get("subtotal") or 0)
        delivery_fee = float(data.get("delivery_fee") or 0)
        total = float(data.get("total") or (subtotal + delivery_fee))
        order_type = data.get("order_type", "delivery")
        payment_method = data.get("payment_method", "cash")
        customer_name = data.get("customer_name", "Cliente").strip()
        customer_phone = data.get("customer_phone", "").strip()
        delivery_address = data.get("delivery_address", "").strip()
        delivery_notes = data.get("delivery_notes", "").strip()

        channel = data.get("channel", "local")
        external_order_id = data.get("external_order_id", "").strip()

        cur.execute("""
            INSERT INTO orders (
                shift_id, order_type, customer_id, customer_name, customer_phone,
                delivery_address, delivery_notes, delivery_courier, delivery_fee,
                status, subtotal, total, payment_method, channel, external_order_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'kitchen', ?, ?, ?, ?, ?, ?, ?)
        """, (
            shift_id, order_type, data.get("customer_id"), customer_name, customer_phone,
            delivery_address, delivery_notes, data.get("delivery_courier", "A confirmar"),
            delivery_fee, subtotal, total, payment_method, channel, external_order_id, sys_dt, sys_dt
        ))
        order_id = cur.lastrowid

        for it in items:
            p_id = it.get("product_id") or it.get("id")
            p_name = it.get("name")
            p_price = float(it.get("price") or it.get("sale_price") or 0)
            p_qty = float(it.get("quantity") or 1)
            p_sub = float(it.get("subtotal") or (p_price * p_qty))
            p_note = it.get("notes", "")

            cur.execute("""
                INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, notes, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
            """, (order_id, p_id, p_name, p_price, p_qty, p_sub, p_note, sys_dt))

            if p_id:
                cur.execute("UPDATE products SET stock = stock - ? WHERE id = ? AND control_stock = 1", (p_qty, p_id))

        conn.commit()

        # Obtener orden completa con items para comprobante
        cur.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
        saved_order = dict(cur.fetchone())
        cur.execute("SELECT * FROM order_items WHERE order_id = ?", (order_id,))
        saved_order["items"] = [dict(r) for r in cur.fetchall()]

        conn.close()
        return jsonify({
            "status": "ok",
            "order_id": order_id,
            "order_type": order_type,
            "order": saved_order,
            "total": total,
            "message": f"Pedido #{order_id} tomado en proceso y enviado a cocina"
        })

    # Listar pedidos de delivery y takeaway activos e históricos del día
    cur.execute("""
        SELECT * FROM orders
        WHERE order_type IN ('delivery', 'takeaway') AND date(created_at) = date('now', 'localtime')
        ORDER BY id DESC
    """)
    orders = [dict(r) for r in cur.fetchall()]
    for o in orders:
        cur.execute("SELECT * FROM order_items WHERE order_id = ?", (o["id"],))
        o["items"] = [dict(i) for i in cur.fetchall()]

    conn.close()
    return jsonify(orders)

@app.route("/api/delivery/<int:order_id>/status", methods=["POST"])
def api_delivery_status(order_id):
    conn = get_db_connection()
    cur = conn.cursor()
    new_status = request.json.get("status") # 'kitchen', 'ready', 'delivered', 'paid', 'cancelled'
    courier = request.json.get("delivery_courier")
    if courier:
        cur.execute("UPDATE orders SET status = ?, delivery_courier = ? WHERE id = ?", (new_status, courier, order_id))
    else:
        cur.execute("UPDATE orders SET status = ? WHERE id = ?", (new_status, order_id))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok", "message": f"Estado actualizado a {new_status}"})

# ----------------- API INTEGRACIONES MULTICANAL: PEDIDOS YA & RAPPI -----------------
@app.route("/api/integrations/status", methods=["GET"])
def api_integrations_status():
    """Retorna el estado de configuración de los canales de delivery."""
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT key, value FROM config WHERE key LIKE 'integration_%'")
    cfg = {row["key"]: row["value"] for row in cur.fetchall()}
    conn.close()
    return jsonify({
        "status": "ok",
        "channels": {
            "pedidosya": {
                "name": "PedidosYa",
                "enabled": cfg.get("integration_pedidosya_enabled", "true") == "true",
                "store_id": cfg.get("integration_pedidosya_store_id", "BIEN-CORRENTINO-01"),
                "portal_url": "https://reception.pedidosya.com/"
            },
            "rappi": {
                "name": "Rappi",
                "enabled": cfg.get("integration_rappi_enabled", "true") == "true",
                "store_id": cfg.get("integration_rappi_store_id", "BIEN-CORRENTINO-RP"),
                "portal_url": "https://aliados.rappi.com/"
            }
        }
    })

@app.route("/api/integrations/webhook/<channel>", methods=["POST"])
def api_integrations_webhook(channel):
    """
    Webhook universal para recibir pedidos de PedidosYa o Rappi en tiempo real.
    Acepta el payload de la plataforma, crea la orden en cocina y activa la alerta sonora.
    """
    channel = channel.lower()
    if channel not in ("pedidosya", "rappi"):
        return jsonify({"error": "Canal no soportado"}), 400

    conn = get_db_connection()
    cur = conn.cursor()
    data = request.json or {}
    sys_dt = get_current_datetime_str(conn)
    shift = get_current_shift(conn)
    shift_id = shift["id"] if shift else None

    # Mapeo universal de datos según canal
    if channel == "pedidosya":
        ext_id = str(data.get("order_id") or data.get("id") or f"PY-{secrets.randbelow(9000) + 1000}")
        cust_name = data.get("customer", {}).get("name") or data.get("customer_name") or "Cliente PedidosYa"
        cust_phone = data.get("customer", {}).get("phone") or data.get("customer_phone") or ""
        address = data.get("delivery_address") or data.get("address", {}).get("description") or "Entrega por repartidor PedidosYa"
        notes = data.get("notes") or data.get("delivery_notes") or "Pedido originado en PedidosYa"
        courier_name = "Repartidor PedidosYa"
    else: # rappi
        ext_id = str(data.get("order_id") or data.get("id") or f"RP-{secrets.randbelow(9000) + 1000}")
        cust_name = data.get("customer", {}).get("name") or data.get("customer_name") or "Cliente Rappi"
        cust_phone = data.get("customer", {}).get("phone") or data.get("customer_phone") or ""
        address = data.get("delivery_address") or data.get("address", {}).get("description") or "Entrega por repartidor Rappi"
        notes = data.get("notes") or data.get("delivery_notes") or "Pedido originado en Rappi"
        courier_name = "Repartidor Rappi"

    raw_items = data.get("items") or []
    # Si no vienen ítems o vienen vacíos, asignar producto por defecto o buscar alguno del menú
    if not raw_items:
        cur.execute("SELECT id, name, sale_price FROM products WHERE is_active = 1 LIMIT 2")
        db_prods = cur.fetchall()
        if db_prods:
            raw_items = [{"product_id": p["id"], "name": p["name"], "price": p["sale_price"], "quantity": 1} for p in db_prods]
        else:
            raw_items = [{"name": "Menú Combo Especial", "price": 4500, "quantity": 1}]

    subtotal = 0.0
    processed_items = []
    for it in raw_items:
        p_id = it.get("product_id") or it.get("id")
        p_name = it.get("name") or it.get("product_name") or "Ítem del Menú"
        p_price = float(it.get("price") or it.get("sale_price") or it.get("unit_price") or 0)
        p_qty = float(it.get("quantity") or 1)
        p_sub = float(it.get("subtotal") or (p_price * p_qty))
        subtotal += p_sub
        processed_items.append({
            "product_id": p_id,
            "product_name": p_name,
            "unit_price": p_price,
            "quantity": p_qty,
            "subtotal": p_sub,
            "notes": it.get("notes", "")
        })

    total = float(data.get("total") or subtotal)
    delivery_fee = float(data.get("delivery_fee") or 0)
    pay_method = f"Plataforma ({channel.capitalize()})"

    cur.execute("""
        INSERT INTO orders (
            shift_id, order_type, customer_name, customer_phone,
            delivery_address, delivery_notes, delivery_courier, delivery_fee,
            status, subtotal, total, payment_method, channel, external_order_id,
            created_at, updated_at
        ) VALUES (?, 'delivery', ?, ?, ?, ?, ?, ?, 'kitchen', ?, ?, ?, ?, ?, ?, ?)
    """, (
        shift_id, cust_name, cust_phone,
        address, notes, courier_name, delivery_fee,
        subtotal, total, pay_method, channel, ext_id,
        sys_dt, sys_dt
    ))
    order_id = cur.lastrowid

    for it in processed_items:
        cur.execute("""
            INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, notes, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        """, (order_id, it["product_id"], it["product_name"], it["unit_price"], it["quantity"], it["subtotal"], it["notes"], sys_dt))

        if it["product_id"]:
            cur.execute("UPDATE products SET stock = stock - ? WHERE id = ? AND control_stock = 1", (it["quantity"], it["product_id"]))

    conn.commit()

    cur.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
    saved_order = dict(cur.fetchone())
    cur.execute("SELECT * FROM order_items WHERE order_id = ?", (order_id,))
    saved_order["items"] = [dict(r) for r in cur.fetchall()]
    conn.close()

    return jsonify({
        "status": "ok",
        "channel": channel,
        "order_id": order_id,
        "external_order_id": ext_id,
        "order": saved_order,
        "message": f"Pedido #{order_id} recibido exitosamente desde {channel.capitalize()}"
    })

@app.route("/api/integrations/simulate", methods=["POST"])
def api_integrations_simulate():
    """
    Simulador con 1 clic para probar en vivo la llegada de un pedido de PedidosYa o Rappi,
    haciendo sonar el timbre y apareciendo en la Cartelera y Cocina.
    """
    channel = (request.json or {}).get("channel", "pedidosya").lower()
    if channel not in ("pedidosya", "rappi"):
        channel = "pedidosya"

    conn = get_db_connection()
    cur = conn.cursor()

    # Elegir 1 o 2 productos reales de la base de datos
    cur.execute("SELECT id, name, sale_price FROM products WHERE is_active = 1 LIMIT 2")
    prods = [dict(r) for r in cur.fetchall()]
    conn.close()

    items = []
    if prods:
        for p in prods:
            items.append({
                "product_id": p["id"],
                "name": p["name"],
                "price": p["sale_price"],
                "quantity": 1,
                "notes": "Sin cebolla" if channel == "pedidosya" else "Bien cocido"
            })
    else:
        items.append({
            "name": "Super Hamburguesa Correntina",
            "price": 3800.0,
            "quantity": 1,
            "notes": "Con papas fritas"
        })

    ext_id = f"PY-{secrets.randbelow(9000) + 1000}" if channel == "pedidosya" else f"RP-{secrets.randbelow(9000) + 1000}"
    cust_name = "Cliente Demo PedidosYa" if channel == "pedidosya" else "Cliente Demo Rappi"

    sim_payload = {
        "order_id": ext_id,
        "customer": {"name": cust_name, "phone": "3794-001122"},
        "delivery_address": "Av. Costanera 1250, Corrientes",
        "notes": f"Pedido de prueba simulado para {channel.capitalize()}",
        "items": items
    }

    # Llamar al webhook interno
    with app.test_request_context(f"/api/integrations/webhook/{channel}", json=sim_payload, method="POST"):
        return api_integrations_webhook(channel)

# ----------------- API CAJA Y ARQUEOS (X / Z) -----------------
@app.route("/api/cash/current", methods=["GET"])
def api_cash_current():
    conn = get_db_connection()
    cur = conn.cursor()
    shift = get_current_shift(conn)
    if not shift:
        conn.close()
        return jsonify({"shift": None, "status": "closed"})

    shift_dict = dict(shift)
    shift_id = shift["id"]

    # Calcular ventas del turno por medio de pago
    cur.execute("""
        SELECT
            op.method,
            SUM(op.amount) as total
        FROM order_payments op
        WHERE op.shift_id = ?
        GROUP BY op.method
    """, (shift_id,))
    pay_rows = cur.fetchall()
    payments_map = {r["method"]: r["total"] for r in pay_rows}

    cash_sales = payments_map.get("cash", 0.0)
    card_debit = payments_map.get("card_debit", 0.0)
    card_credit = payments_map.get("card_credit", 0.0)
    transfer = payments_map.get("transfer", 0.0)
    customer_credit = payments_map.get("credit", 0.0)

    # Movimientos manuales de caja
    cur.execute("SELECT type, SUM(amount) as total FROM cash_movements WHERE shift_id = ? GROUP BY type", (shift_id,))
    mov_rows = cur.fetchall()
    mov_map = {r["type"]: r["total"] for r in mov_rows}
    incomes = mov_map.get("income", 0.0)
    expenses = mov_map.get("expense", 0.0)

    # Efectivo esperado en gaveta = saldo inicial + ventas en efectivo + ingresos manuales - egresos manuales
    expected_cash = shift["initial_cash"] + cash_sales + incomes - expenses
    total_sales = cash_sales + card_debit + card_credit + transfer + customer_credit

    cur.execute("SELECT * FROM cash_movements WHERE shift_id = ? ORDER BY id DESC", (shift_id,))
    movements = [dict(m) for m in cur.fetchall()]

    shift_dict.update({
        "cash_sales": cash_sales,
        "card_debit": card_debit,
        "card_credit": card_credit,
        "transfer": transfer,
        "customer_credit": customer_credit,
        "incomes": incomes,
        "expenses": expenses,
        "expected_cash": expected_cash,
        "total_sales": total_sales,
        "movements": movements
    })

    conn.close()
    return jsonify({"shift": shift_dict, "status": "open"})

@app.route("/api/cash/open", methods=["POST"])
def api_cash_open():
    conn = get_db_connection()
    cur = conn.cursor()
    shift = get_current_shift(conn)
    if shift:
        conn.close()
        return jsonify({"error": "Ya existe una caja abierta actualmente"}), 400

    data = request.json or {}
    cashier = data.get("cashier_name", "Cajero Principal")
    initial_cash = float(data.get("initial_cash") or 0.0)
    sys_dt = get_current_datetime_str(conn)

    cur.execute("""
        INSERT INTO cash_shifts (opened_at, cashier_name, initial_cash, status)
        VALUES (?, ?, ?, 'open')
    """, (sys_dt, cashier, initial_cash))
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return jsonify({"status": "ok", "shift_id": new_id, "message": "Caja abierta exitosamente"})

@app.route("/api/cash/movement", methods=["POST"])
def api_cash_movement():
    conn = get_db_connection()
    cur = conn.cursor()
    shift = get_current_shift(conn)
    if not shift:
        conn.close()
        return jsonify({"error": "No hay caja abierta para registrar movimientos"}), 400

    data = request.json
    m_type = data.get("type", "expense") # 'income' o 'expense'
    amount = float(data.get("amount") or 0)
    concept = data.get("concept", "").strip()

    if amount <= 0 or not concept:
        conn.close()
        return jsonify({"error": "Monto y concepto son requeridos"}), 400

    cur.execute("""
        INSERT INTO cash_movements (shift_id, type, amount, concept)
        VALUES (?, ?, ?, ?)
    """, (shift["id"], m_type, amount, concept))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok", "message": "Movimiento registrado exitosamente"})

@app.route("/api/cash/close", methods=["POST"])
def api_cash_close():
    conn = get_db_connection()
    cur = conn.cursor()
    shift = get_current_shift(conn)
    if not shift:
        conn.close()
        return jsonify({"error": "No hay una caja abierta para cerrar"}), 400

    shift_id = shift["id"]
    data = request.json
    final_cash_real = float(data.get("final_cash_real") or 0)
    notes = data.get("notes", "").strip()

    # Calcular ventas
    cur.execute("SELECT method, SUM(amount) as total FROM order_payments WHERE shift_id = ? GROUP BY method", (shift_id,))
    payments_map = {r["method"]: r["total"] for r in cur.fetchall()}
    cash_sales = payments_map.get("cash", 0.0)
    card_debit = payments_map.get("card_debit", 0.0)
    card_credit = payments_map.get("card_credit", 0.0)
    transfer = payments_map.get("transfer", 0.0)
    customer_credit = payments_map.get("credit", 0.0)

    cur.execute("SELECT type, SUM(amount) as total FROM cash_movements WHERE shift_id = ? GROUP BY type", (shift_id,))
    mov_map = {r["type"]: r["total"] for r in cur.fetchall()}
    incomes = mov_map.get("income", 0.0)
    expenses = mov_map.get("expense", 0.0)

    expected_cash = shift["initial_cash"] + cash_sales + incomes - expenses
    total_sales = cash_sales + card_debit + card_credit + transfer + customer_credit
    diff = final_cash_real - expected_cash
    sys_dt = get_current_datetime_str(conn)

    cur.execute("""
        UPDATE cash_shifts SET
            closed_at = ?,
            final_cash_real = ?,
            final_cash_system = ?,
            total_sales = ?,
            total_cash = ?,
            total_card_debit = ?,
            total_card_credit = ?,
            total_transfer = ?,
            total_customer_credit = ?,
            difference = ?,
            notes = ?,
            status = 'closed'
        WHERE id = ?
    """, (
        sys_dt,
        final_cash_real, expected_cash, total_sales, cash_sales, card_debit, card_credit,
        transfer, customer_credit, diff, notes, shift_id
    ))
    conn.commit()

    cur.execute("SELECT * FROM cash_shifts WHERE id = ?", (shift_id,))
    closed_shift = dict(cur.fetchone())
    conn.close()
    return jsonify({"status": "ok", "shift": closed_shift, "message": "Turno de caja cerrado exitosamente"})

@app.route("/api/cash/history", methods=["GET"])
def api_cash_history():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM cash_shifts ORDER BY id DESC LIMIT 30")
    shifts = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(shifts)

# ----------------- API CLIENTES & CUENTAS CORRIENTES -----------------
@app.route("/api/customers", methods=["GET", "POST"])
def api_customers():
    conn = get_db_connection()
    cur = conn.cursor()
    if request.method == "POST":
        data = request.json
        name = data.get("name", "").strip()
        phone = data.get("phone", "").strip()
        email = data.get("email", "").strip()
        address = data.get("address", "").strip()
        notes = data.get("notes", "").strip()
        credit_limit = float(data.get("credit_limit") or 0)

        if not name:
            conn.close()
            return jsonify({"error": "El nombre es obligatorio"}), 400
        
        cur.execute("""
            INSERT INTO customers (name, phone, email, address, notes, credit_limit)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (name, phone, email, address, notes, credit_limit))
        conn.commit()
        new_id = cur.lastrowid
        conn.close()
        return jsonify({"status": "ok", "id": new_id, "message": "Cliente registrado"})

    q = request.args.get("q", "").strip().lower()
    sql = "SELECT * FROM customers WHERE 1=1"
    params = []
    if q:
        sql += " AND (LOWER(name) LIKE ? OR LOWER(phone) LIKE ? OR LOWER(email) LIKE ?)"
        params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])
    sql += " ORDER BY name ASC"
    cur.execute(sql, params)
    custs = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(custs)

@app.route("/api/customers/<int:cust_id>", methods=["PUT", "GET"])
def api_customer_detail(cust_id):
    conn = get_db_connection()
    cur = conn.cursor()
    if request.method == "GET":
        cur.execute("SELECT * FROM customers WHERE id = ?", (cust_id,))
        c = dict_from_row(cur.fetchone())
        if not c:
            conn.close()
            return jsonify({"error": "No encontrado"}), 404
        cur.execute("SELECT * FROM customer_ledger WHERE customer_id = ? ORDER BY id DESC", (cust_id,))
        c["ledger"] = [dict(r) for r in cur.fetchall()]
        conn.close()
        return jsonify(c)

    data = request.json
    cur.execute("""
        UPDATE customers SET name = ?, phone = ?, email = ?, address = ?, notes = ?, credit_limit = ?
        WHERE id = ?
    """, (data.get("name"), data.get("phone"), data.get("email"), data.get("address"), data.get("notes"), float(data.get("credit_limit") or 0), cust_id))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok", "message": "Cliente actualizado"})

@app.route("/api/customers/<int:cust_id>/payment", methods=["POST"])
def api_customer_payment(cust_id):
    conn = get_db_connection()
    cur = conn.cursor()
    data = request.json
    amount = float(data.get("amount") or 0)
    notes = data.get("notes", "Abono a cuenta corriente")

    if amount <= 0:
        conn.close()
        return jsonify({"error": "El monto debe ser mayor a 0"}), 400

    cur.execute("SELECT balance FROM customers WHERE id = ?", (cust_id,))
    c_row = cur.fetchone()
    if not c_row:
        conn.close()
        return jsonify({"error": "Cliente no encontrado"}), 404

    current_bal = c_row["balance"]
    new_bal = current_bal - amount
    cur.execute("UPDATE customers SET balance = ? WHERE id = ?", (new_bal, cust_id))
    cur.execute("""
        INSERT INTO customer_ledger (customer_id, type, amount, balance_after, notes)
        VALUES (?, 'payment', ?, ?, ?)
    """, (cust_id, amount, new_bal, notes))

    # También registrar como ingreso en caja si hay turno abierto
    shift = get_current_shift(conn)
    if shift:
        cur.execute("""
            INSERT INTO cash_movements (shift_id, type, amount, concept)
            VALUES (?, 'income', ?, ?)
        """, (shift["id"], amount, f"Cobro Cta. Cte. Cliente #{cust_id}"))

    conn.commit()
    conn.close()
    return jsonify({"status": "ok", "new_balance": new_bal, "message": "Abono registrado exitosamente"})

# ----------------- API REPORTES & ESTADÍSTICAS -----------------
@app.route("/api/reports/dashboard", methods=["GET"])
def api_reports_dashboard():
    conn = get_db_connection()
    cur = conn.cursor()
    curr_date = get_current_date_str(conn)

    # Métricas de hoy
    cur.execute("""
        SELECT
            COUNT(*) as ticket_count,
            COALESCE(SUM(total), 0) as today_sales,
            COALESCE(AVG(total), 0) as avg_ticket
        FROM orders
        WHERE date(created_at) = ? AND status = 'paid'
    """, (curr_date,))
    today_stats = dict(cur.fetchone())

    # Ventas de los últimos 7 días
    cur.execute("""
        SELECT
            date(created_at) as sale_date,
            COUNT(*) as tickets,
            SUM(total) as total_amount
        FROM orders
        WHERE date(created_at) >= date(?, '-6 days') AND date(created_at) <= ? AND status = 'paid'
        GROUP BY date(created_at)
        ORDER BY sale_date ASC
    """, (curr_date, curr_date))
    daily_sales = [dict(r) for r in cur.fetchall()]

    # Ventas por medio de pago (últimos 30 días)
    cur.execute("""
        SELECT
            op.method,
            SUM(op.amount) as amount,
            COUNT(*) as count
        FROM order_payments op
        JOIN orders o ON op.order_id = o.id
        WHERE o.status = 'paid' AND date(o.created_at) >= date(?, '-30 days') AND date(o.created_at) <= ?
        GROUP BY op.method
    """, (curr_date, curr_date))
    payment_stats = [dict(r) for r in cur.fetchall()]

    # Top 10 productos más vendidos
    cur.execute("""
        SELECT
            oi.product_name,
            SUM(oi.quantity) as total_qty,
            SUM(oi.subtotal) as total_revenue
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.status = 'paid'
        GROUP BY oi.product_name
        ORDER BY total_qty DESC
        LIMIT 10
    """)
    top_products = [dict(r) for r in cur.fetchall()]

    # Alertas de stock bajo
    cur.execute("""
        SELECT p.id, p.code, p.name, p.stock, p.min_stock, c.name as category_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.is_active = 1 AND p.control_stock = 1 AND p.stock <= p.min_stock
        ORDER BY p.stock ASC
        LIMIT 10
    """)
    low_stock_alerts = [dict(r) for r in cur.fetchall()]

    conn.close()
    return jsonify({
        "today": today_stats,
        "daily_sales": daily_sales,
        "payment_stats": payment_stats,
        "top_products": top_products,
        "low_stock_alerts": low_stock_alerts
    })

@app.route("/api/reports/sales", methods=["GET"])
def api_reports_sales():
    conn = get_db_connection()
    cur = conn.cursor()

    limit = int(request.args.get("limit", 50))
    date_filter = request.args.get("date")

    sql = """
        SELECT o.*, t.name as table_name, c.name as customer_name_db,
               COALESCE(u.name, 'Admin') as cashier_user_name
        FROM orders o
        LEFT JOIN restaurant_tables t ON o.table_id = t.id
        LEFT JOIN customers c ON o.customer_id = c.id
        LEFT JOIN users u ON (o.paid_by_user_id = u.id OR o.user_id = u.id)
        WHERE 1=1
    """
    params = []
    if date_filter:
        sql += " AND date(o.created_at) = ?"
        params.append(date_filter)

    sql += " ORDER BY o.id DESC LIMIT ?"
    params.append(limit)

    cur.execute(sql, params)
    sales = [dict(r) for r in cur.fetchall()]

    for s in sales:
        cur.execute("SELECT * FROM order_items WHERE order_id = ?", (s["id"],))
        s["items"] = [dict(i) for i in cur.fetchall()]
        cur.execute("SELECT * FROM order_payments WHERE order_id = ?", (s["id"],))
        s["payments"] = [dict(p) for p in cur.fetchall()]

    conn.close()
    return jsonify(sales)

def _delete_order_internal(cur, order_id, restore_stock, auth_user_id):
    cur.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
    order = cur.fetchone()
    if not order:
        return False

    if restore_stock:
        cur.execute("SELECT product_id, quantity FROM order_items WHERE order_id = ?", (order_id,))
        items = cur.fetchall()
        for it in items:
            if it["product_id"]:
                cur.execute("""
                    UPDATE products SET stock = stock + ?
                    WHERE id = ? AND control_stock = 1
                """, (it["quantity"], it["product_id"]))

    # Si hubo pago con cta. cte. (credit), descontar deuda al cliente
    cur.execute("SELECT amount FROM order_payments WHERE order_id = ? AND method = 'credit'", (order_id,))
    credit_pays = cur.fetchall()
    if credit_pays and order["customer_id"]:
        for cp in credit_pays:
            cur.execute("UPDATE customers SET balance = balance - ? WHERE id = ?", (cp["amount"], order["customer_id"]))
            cur.execute("""
                INSERT INTO customer_ledger (customer_id, type, amount, balance_after, order_id, notes)
                SELECT id, 'payment', ?, balance, ?, 'Reversión por ticket eliminado #' || ?
                FROM customers WHERE id = ?
            """, (cp["amount"], order_id, order_id, order["customer_id"]))

    # Eliminar registros asociados
    cur.execute("DELETE FROM order_payments WHERE order_id = ?", (order_id,))
    cur.execute("DELETE FROM order_items WHERE order_id = ?", (order_id,))
    cur.execute("DELETE FROM orders WHERE id = ?", (order_id,))
    cur.execute("INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (?, 'delete_order', 'orders', ?)",
                (auth_user_id, order_id))
    return True

@app.route("/api/reports/sales/bulk_delete", methods=["POST", "DELETE"])
@require_admin
def api_reports_sales_bulk_delete():
    conn = get_db_connection()
    auth_user = get_authenticated_user(conn)
    if not auth_user or auth_user.get("role") != "admin":
        conn.close()
        return jsonify({"error": "Acceso denegado: Los empleados (Romina, Brisa) no tienen permiso para eliminar reportes de venta. Esta operación es exclusiva del Dueño."}), 403
    cur = conn.cursor()

    data = request.json or {}
    order_ids = data.get("order_ids") or []
    if not order_ids or not isinstance(order_ids, list):
        conn.close()
        return jsonify({"error": "No se especificaron tickets para eliminar"}), 400

    restore_stock = bool(data.get("restore_stock", True))
    deleted_count = 0
    for oid in order_ids:
        try:
            oid_int = int(oid)
            if _delete_order_internal(cur, oid_int, restore_stock, auth_user["id"]):
                deleted_count += 1
        except (ValueError, TypeError):
            continue

    conn.commit()
    conn.close()
    return jsonify({
        "status": "ok",
        "deleted_count": deleted_count,
        "message": f"Se eliminaron {deleted_count} ticket(s) exitosamente"
    })

@app.route("/api/reports/sales/<int:order_id>", methods=["PUT", "DELETE"])
@require_admin
def api_reports_sale_detail(order_id):
    conn = get_db_connection()
    auth_user = get_authenticated_user(conn)
    if not auth_user or auth_user.get("role") != "admin":
        conn.close()
        return jsonify({"error": "Acceso denegado: Los empleados (Romina, Brisa) no tienen permiso para modificar o eliminar reportes de venta. Esta operación es exclusiva del Dueño."}), 403
    cur = conn.cursor()
    cur.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
    order = cur.fetchone()
    if not order:
        conn.close()
        return jsonify({"error": "Venta no encontrada"}), 404

    if request.method == "DELETE":
        restore_stock = request.args.get("restore_stock", "1") == "1"
        success = _delete_order_internal(cur, order_id, restore_stock, auth_user["id"])
        if not success:
            conn.close()
            return jsonify({"error": "No se pudo eliminar el ticket"}), 400
        conn.commit()
        conn.close()
        return jsonify({"status": "ok", "message": f"Ticket #{order_id} eliminado exitosamente"})

    # PUT: Editar venta existente (fecha, hora, medio de pago, total, notas, cliente)
    data = request.json or {}
    created_at = (data.get("created_at") or "").strip() or order["created_at"]
    created_at = created_at.replace("T", " ")
    if len(created_at) == 16:
        created_at += ":00"

    closed_at = created_at
    payment_method = data.get("payment_method") or order["payment_method"]
    customer_name = data.get("customer_name") if data.get("customer_name") is not None else order["customer_name"]
    notes = data.get("notes") if data.get("notes") is not None else order["notes"]

    try:
        total = float(data.get("total") if data.get("total") is not None else order["total"])
    except (ValueError, TypeError):
        total = float(order["total"])

    cur.execute("""
        UPDATE orders SET
            created_at = ?,
            closed_at = ?,
            payment_method = ?,
            total = ?,
            amount_paid = ?,
            customer_name = ?,
            notes = ?,
            updated_at = datetime('now', 'localtime')
        WHERE id = ?
    """, (created_at, closed_at, payment_method, total, total, customer_name, notes, order_id))

    # Actualizar o insertar pago correspondiente
    cur.execute("SELECT id FROM order_payments WHERE order_id = ? ORDER BY id ASC LIMIT 1", (order_id,))
    first_payment = cur.fetchone()
    if first_payment:
        cur.execute("""
            UPDATE order_payments SET
                method = ?,
                amount = ?,
                created_at = ?
            WHERE id = ?
        """, (payment_method, total, created_at, first_payment["id"]))
    else:
        cur.execute("""
            INSERT INTO order_payments (order_id, shift_id, method, amount, reference, created_at, user_id)
            VALUES (?, ?, ?, ?, '', ?, ?)
        """, (order_id, order["shift_id"], payment_method, total, created_at, auth_user["id"]))

    cur.execute("INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (?, 'edit_order', 'orders', ?)",
                (auth_user["id"], order_id))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok", "message": f"Ticket #{order_id} actualizado exitosamente"})

# ----------------- MONITOREO DE EMPLEADOS EN VIVO (SOLO DUEÑO) -----------------
@app.route("/api/reports/live_monitoring", methods=["GET"])
@require_admin
def api_reports_live_monitoring():
    conn = get_db_connection()
    cur = conn.cursor()
    curr_date = get_current_date_str(conn)

    # 1. Ventas de hoy por cada empleado
    cur.execute("""
        SELECT 
            u.id as user_id,
            u.name as user_name,
            u.role,
            COUNT(o.id) as tickets_count,
            COALESCE(SUM(o.total), 0) as total_sold,
            COALESCE(AVG(o.total), 0) as avg_ticket
        FROM users u
        LEFT JOIN orders o ON (o.paid_by_user_id = u.id OR o.user_id = u.id) 
            AND o.status = 'paid' 
            AND date(o.closed_at) = ?
        WHERE u.is_active = 1
        GROUP BY u.id
        ORDER BY total_sold DESC
    """, (curr_date,))
    employees_stats = [dict(r) for r in cur.fetchall()]

    # Para cada empleado, desglose de medios de pago hoy
    for emp in employees_stats:
        cur.execute("""
            SELECT op.method, COALESCE(SUM(op.amount), 0) as amount
            FROM order_payments op
            JOIN orders o ON op.order_id = o.id
            WHERE (op.user_id = ? OR o.paid_by_user_id = ?)
              AND o.status = 'paid'
              AND date(o.closed_at) = ?
            GROUP BY op.method
        """, (emp["user_id"], emp["user_id"], curr_date))
        emp["payments"] = {r["method"]: r["amount"] for r in cur.fetchall()}

    # 2. Feed en vivo de las últimas ventas hoy con detalle
    cur.execute("""
        SELECT 
            o.id,
            o.order_type,
            o.total,
            o.payment_method,
            o.closed_at,
            o.customer_name,
            COALESCE(u.name, 'Admin') as cashier_name,
            t.number as table_number
        FROM orders o
        LEFT JOIN users u ON (o.paid_by_user_id = u.id OR o.user_id = u.id)
        LEFT JOIN restaurant_tables t ON o.table_id = t.id
        WHERE o.status = 'paid' AND date(o.closed_at) = ?
        ORDER BY o.closed_at DESC
        LIMIT 25
    """, (curr_date,))
    recent_activity = [dict(r) for r in cur.fetchall()]

    for act in recent_activity:
        cur.execute("SELECT product_name, quantity, subtotal FROM order_items WHERE order_id = ?", (act["id"],))
        act["items"] = [dict(i) for i in cur.fetchall()]

    # 3. Estado de caja actual
    shift = get_current_shift(conn)
    shift_info = dict(shift) if shift else None

    conn.close()
    return jsonify({
        "status": "ok",
        "employees_stats": employees_stats,
        "recent_activity": recent_activity,
        "shift": shift_info
    })


# ----------------- BACKUP & RESTORE -----------------
@app.route("/api/backup/download", methods=["GET"])
@require_admin
def api_backup_download():
    return send_file(DB_PATH, as_attachment=True, download_name=f"posberry_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db")

# ----------------- ESTADO DE TÚNEL ONLINE & DESCARGA DE APK -----------------
@app.route("/api/tunnel/info", methods=["GET"])
def api_tunnel_info():
    info_path = os.path.join(app.static_folder, "tunnel_info.json")
    if os.path.exists(info_path):
        try:
            with open(info_path, "r", encoding="utf-8") as f:
                return jsonify(json.load(f))
        except Exception:
            pass
    return jsonify({"status": "offline", "url": None})

@app.route("/download/biencorrentino.apk", methods=["GET"])
@app.route("/download/rsmarket.apk", methods=["GET"])
@app.route("/download/RSMarket.apk", methods=["GET"])
@app.route("/download/posberry.apk", methods=["GET"])
@app.route("/api/download/apk", methods=["GET"])
def download_apk():
    apk_path = os.path.join(app.static_folder, "downloads", "biencorrentino.apk")
    if not os.path.exists(apk_path):
        apk_path = os.path.join(app.static_folder, "downloads", "RSMarket.apk")
    if not os.path.exists(apk_path):
        apk_path = os.path.join(app.static_folder, "downloads", "POSBerry.apk")
    if os.path.exists(apk_path):
        return send_file(apk_path, as_attachment=True, download_name="biencorrentino.apk", mimetype="application/vnd.android.package-archive")
    return jsonify({"error": "El instalador APK aún no está generado"}), 404

# Rutas PWA (Manifest y Service Worker con scope '/')
@app.route("/manifest.json")
def pwa_manifest():
    return send_file(os.path.join(app.static_folder, "manifest.json"), mimetype="application/manifest+json")

@app.route("/sw.js")
def pwa_sw():
    response = send_file(os.path.join(app.static_folder, "sw.js"), mimetype="application/javascript")
    response.headers["Service-Worker-Allowed"] = "/"
    return response

if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1")
    port = int(os.environ.get("PORT", "5050"))
    app.run(host=host, port=port, debug=False, threaded=True)
