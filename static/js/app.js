// POSBerry Open - Lógica Principal SPA

// Interceptor global de fetch para enviar el X-User-Id del operador autenticado y bypass de ngrok
const _nativeFetch = window.fetch;
window.fetch = function (url, options = {}) {
    options = options || {};
    options.headers = options.headers || {};
    const userId = State.currentUser?.id;
    if (options.headers instanceof Headers) {
        if (userId) {
            options.headers.set('X-User-Id', String(userId));
        } else {
            options.headers.delete('X-User-Id');
        }
        options.headers.set('ngrok-skip-browser-warning', '1');
    } else {
        if (userId) {
            options.headers['X-User-Id'] = String(userId);
        } else {
            delete options.headers['X-User-Id'];
        }
        options.headers['ngrok-skip-browser-warning'] = '1';
    }
    return _nativeFetch(url, options);
};

// Sistema Global de Notificaciones Flotantes (Toast)
function showToast(message, type = 'info', duration = 3500) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'fixed top-4 left-1/2 -translate-x-1/2 z-[250] flex flex-col items-center gap-2 pointer-events-none w-11/12 max-w-md';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl border text-sm font-bold transition-all duration-300 transform -translate-y-4 opacity-0 max-w-full';

    let iconHtml = '';
    if (type === 'success') {
        toast.className += ' bg-emerald-600 text-white border-emerald-400 shadow-emerald-600/30';
        iconHtml = '<i data-lucide="check-circle" class="w-5 h-5 flex-shrink-0 text-white"></i>';
    } else if (type === 'warn' || type === 'warning') {
        toast.className += ' bg-amber-500 text-slate-950 border-amber-300 shadow-amber-500/30';
        iconHtml = '<i data-lucide="clock" class="w-5 h-5 flex-shrink-0 text-slate-950"></i>';
    } else if (type === 'error') {
        toast.className += ' bg-rose-600 text-white border-rose-400 shadow-rose-600/30';
        iconHtml = '<i data-lucide="alert-circle" class="w-5 h-5 flex-shrink-0 text-white"></i>';
    } else {
        toast.className += ' bg-blue-600 text-white border-blue-400 shadow-blue-600/30';
        iconHtml = '<i data-lucide="info" class="w-5 h-5 flex-shrink-0 text-white"></i>';
    }

    toast.innerHTML = `
        ${iconHtml}
        <span class="flex-1 text-xs sm:text-sm tracking-wide leading-tight">${message}</span>
        <button type="button" class="ml-2 text-current opacity-70 hover:opacity-100 transition p-1" onclick="this.parentElement.remove()">
            <i data-lucide="x" class="w-4 h-4"></i>
        </button>
    `;

    container.appendChild(toast);
    if (window.lucide) lucide.createIcons();

    requestAnimationFrame(() => {
        toast.classList.remove('-translate-y-4', 'opacity-0');
        toast.classList.add('translate-y-0', 'opacity-100');
    });

    setTimeout(() => {
        toast.classList.add('opacity-0', '-translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Estado Global de la Aplicación
const State = {
    currentUser: null,
    isAuthenticated: false,
    enteredPin: '',
    selectedLoginUserId: null,
    loginUsersList: [],
    monitoringInterval: null,
    config: {
        currency: '$',
        business_name: 'POSBerry',
        business_subtitle: '',
        cuit: '',
        address: '',
        phone: '',
        ticket_header: '',
        ticket_footer: ''
    },
    categories: [],
    products: [],
    currentCart: {
        items: [],
        discountPercent: 0,
        surchargeAmount: 0,
        customerId: null,
        customerName: 'Consumidor Final'
    },
    activeCategoryFilter: null,
    currentTable: null,
    currentShift: null,
    selectedPaymentMethod: 'cash',
    activeDeliveryItems: [],
    salesChart: null,
    paymentsChart: null,
    kdsInterval: null
};

// ==================== INICIALIZACIÓN ====================
document.addEventListener('DOMContentLoaded', async () => {
    initClock();
    initKeyboardShortcuts();
    await initAuthUser();
    await loadConfig();
    await loadCategories();
    await loadProducts();
    await checkCurrentShift();
    initPwaAndOnline();
    
    // Iniciar en vista Mostrador
    navigateTo('pos');

    // Cargar estado inicial de pedidos y refrescar contadores/badges de las pestañas
    loadOrdersLiveStatus();
    setInterval(loadOrdersLiveStatus, 4000);

    // Inicializar iconos de Lucide
    if (window.lucide) {
        lucide.createIcons();
    }
});

// Reloj y sincronización de fecha/hora del sistema (Día, Mes, Año, Horario)
let systemClockOffsetMs = 0;
let systemClockMode = 'auto';

async function fetchSystemDateTime() {
    try {
        const res = await fetch('/api/config/datetime');
        const data = await res.json();
        systemClockMode = data.mode || 'auto';
        if (data.mode === 'manual' && data.current_datetime) {
            const serverSimulatedTime = new Date(data.current_datetime.replace(' ', 'T')).getTime();
            systemClockOffsetMs = serverSimulatedTime - Date.now();
        } else {
            systemClockOffsetMs = 0;
        }
        updateClockUI();
        updateSettingsDateTimeUI(data);
    } catch (e) {
        console.error('Error fetching system datetime:', e);
    }
}

function getSystemCurrentDate() {
    return new Date(Date.now() + systemClockOffsetMs);
}

function updateClockUI() {
    const clockEl = document.getElementById('live-clock');
    const badgeEl = document.getElementById('clock-manual-badge');
    const now = getSystemCurrentDate();
    if (clockEl) {
        clockEl.textContent = now.toLocaleTimeString('es-AR', { hour12: false });
    }
    if (badgeEl) {
        if (systemClockMode === 'manual') {
            badgeEl.classList.remove('hidden');
            const day = String(now.getDate()).padStart(2, '0');
            const mon = String(now.getMonth() + 1).padStart(2, '0');
            const yr = now.getFullYear();
            badgeEl.textContent = `Manual: ${day}/${mon}/${yr}`;
        } else {
            badgeEl.classList.add('hidden');
        }
    }
}

function initClock() {
    fetchSystemDateTime();
    setInterval(updateClockUI, 1000);
    setInterval(fetchSystemDateTime, 30000);
}

function openDateTimeModal() {
    if (State.currentUser?.role !== 'admin') {
        alert('Solo el Dueño / Administrador puede modificar la fecha y hora del sistema.');
        return;
    }
    const modal = document.getElementById('modal-system-datetime');
    if (!modal) return;
    const now = getSystemCurrentDate();
    const yr = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const da = String(now.getDate()).padStart(2, '0');
    const ho = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const localIso = `${yr}-${mo}-${da}T${ho}:${mi}`;

    const input = document.getElementById('quick-system-datetime-input');
    if (input) input.value = localIso;

    const autoRadio = document.getElementById('quick-time-mode-auto');
    const manualRadio = document.getElementById('quick-time-mode-manual');
    if (systemClockMode === 'manual') {
        if (manualRadio) manualRadio.checked = true;
    } else {
        if (autoRadio) autoRadio.checked = true;
    }
    toggleQuickDateTimeInputs();
    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}

function closeDateTimeModal() {
    const modal = document.getElementById('modal-system-datetime');
    if (modal) modal.classList.add('hidden');
}

function toggleQuickDateTimeInputs() {
    const manual = document.getElementById('quick-time-mode-manual')?.checked;
    const fields = document.getElementById('quick-datetime-fields');
    if (fields) {
        if (manual) fields.classList.remove('hidden');
        else fields.classList.add('hidden');
    }
}

async function saveQuickSystemDateTime() {
    const isManual = document.getElementById('quick-time-mode-manual')?.checked;
    const dtVal = document.getElementById('quick-system-datetime-input')?.value;
    if (isManual && !dtVal) {
        alert('Por favor selecciona una fecha y horario.');
        return;
    }

    try {
        const payload = isManual ? { mode: 'manual', datetime: dtVal } : { mode: 'auto' };
        const res = await fetch('/api/config/datetime', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.status === 'ok') {
            closeDateTimeModal();
            await fetchSystemDateTime();
            await loadReports();
            await loadSalesHistory();
            alert(data.message || 'Fecha y hora actualizadas');
        } else {
            alert(data.error || 'Error al actualizar');
        }
    } catch (e) {
        console.error('Error saving system datetime:', e);
        alert('Error al conectar con el servidor.');
    }
}

function updateSettingsDateTimeUI(info) {
    const autoRadio = document.getElementById('cfg-time-mode-auto');
    const manualRadio = document.getElementById('cfg-time-mode-manual');
    const badge = document.getElementById('cfg-datetime-mode-badge');
    const input = document.getElementById('cfg-system-datetime-input');

    if (info.mode === 'manual') {
        if (manualRadio) manualRadio.checked = true;
        if (badge) {
            badge.textContent = 'Manual Personalizado';
            badge.className = 'text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800';
        }
    } else {
        if (autoRadio) autoRadio.checked = true;
        if (badge) {
            badge.textContent = 'Automático (Tiempo Real)';
            badge.className = 'text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800';
        }
    }

    if (input && info.current_datetime) {
        input.value = info.current_datetime.substring(0, 16).replace(' ', 'T');
    }
    toggleCustomDateTimeInputs();
}

function toggleCustomDateTimeInputs() {
    const manual = document.getElementById('cfg-time-mode-manual')?.checked;
    const fields = document.getElementById('cfg-manual-datetime-fields');
    if (fields) {
        if (manual) fields.classList.remove('hidden');
        else fields.classList.add('hidden');
    }
}

async function saveSystemDateTimeFromSettings() {
    const isManual = document.getElementById('cfg-time-mode-manual')?.checked;
    const dtVal = document.getElementById('cfg-system-datetime-input')?.value;
    if (isManual && !dtVal) {
        alert('Por favor selecciona una fecha y horario.');
        return;
    }
    try {
        const payload = isManual ? { mode: 'manual', datetime: dtVal } : { mode: 'auto' };
        const res = await fetch('/api/config/datetime', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.status === 'ok') {
            await fetchSystemDateTime();
            await loadReports();
            await loadSalesHistory();
            alert(data.message || 'Fecha y hora del sistema actualizadas exitosamente');
        } else {
            alert(data.error || 'Error al guardar');
        }
    } catch (e) {
        console.error('Error saving system datetime from settings:', e);
    }
}

async function resetSystemDateTime() {
    try {
        const res = await fetch('/api/config/datetime', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'auto' })
        });
        const data = await res.json();
        if (data.status === 'ok') {
            await fetchSystemDateTime();
            await loadReports();
            await loadSalesHistory();
            alert('Fecha y hora restablecidas a tiempo real automático.');
        }
    } catch (e) {
        console.error(e);
    }
}


// Atajos de Teclado Globales
function initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        // F2: Buscar producto
        if (e.key === 'F2') {
            e.preventDefault();
            const search = document.getElementById('pos-search-input');
            if (search) {
                navigateTo('pos');
                search.focus();
                search.select();
            }
        }
        // F4: Cobrar venta
        if (e.key === 'F4') {
            e.preventDefault();
            if (State.currentCart.items.length > 0) {
                openCheckoutModal();
            }
        }
        // F7: Mesas
        if (e.key === 'F7') {
            e.preventDefault();
            navigateTo('tables');
        }
        // Esc: Cerrar modal o limpiar
        if (e.key === 'Escape') {
            closeAllModals();
        }
    });

    // Lector de código de barras en input de búsqueda
    const searchInput = document.getElementById('pos-search-input');
    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const query = searchInput.value.trim();
                if (!query) return;
                
                // Buscar por coincidencia exacta de código
                const match = State.products.find(p => p.code.toLowerCase() === query.toLowerCase());
                if (match) {
                    addToCart(match);
                    searchInput.value = '';
                    clearPosSearch();
                }
            }
        });
        searchInput.addEventListener('input', () => {
            renderPosProducts();
        });
    }
}

function closeAllModals() {
    const modals = [
        'modal-checkout', 'modal-ticket', 'modal-table-order', 'modal-open-table',
        'modal-product', 'modal-cash-movement', 'modal-close-shift', 'modal-customer',
        'modal-new-delivery', 'modal-shortcuts', 'modal-user-login'
    ];
    modals.forEach(id => {
        const m = document.getElementById(id);
        if (m) m.classList.add('hidden');
    });
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

function openShortcutsModal() {
    document.getElementById('modal-shortcuts').classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}
function closeShortcutsModal() {
    document.getElementById('modal-shortcuts').classList.add('hidden');
}

// ==================== NAVEGACIÓN ENTRE VISTAS ====================
function navigateTo(viewName) {
    // Parar intervalos en segundo plano si cambiamos de vista
    if (State.kdsInterval) {
        clearInterval(State.kdsInterval);
        State.kdsInterval = null;
    }
    if (State.monitoringInterval) {
        clearInterval(State.monitoringInterval);
        State.monitoringInterval = null;
    }
    if (State.ordersLiveInterval) {
        clearInterval(State.ordersLiveInterval);
        State.ordersLiveInterval = null;
    }

    // Si el usuario es empleado y trata de entrar a configuración, bloquear
    if (viewName === 'settings' && State.currentUser?.role !== 'admin') {
        alert('Acceso Restringido: Solo el Dueño / Administrador puede acceder a la configuración.');
        navigateTo('pos');
        return;
    }

    // Actualizar botones de navegación en sidebar (Desktop)
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.remove('text-white', 'bg-blue-600', 'shadow-sm');
        btn.classList.add('text-slate-400', 'hover:text-slate-200', 'hover:bg-slate-800/80');
    });
    const activeNav = document.getElementById(`nav-${viewName}`);
    if (activeNav) {
        activeNav.classList.remove('text-slate-400', 'hover:text-slate-200', 'hover:bg-slate-800/80');
        activeNav.classList.add('text-white', 'bg-blue-600', 'shadow-sm');
    }

    // Actualizar botones de barra inferior móvil (Mobile Bottom Bar)
    const mobTabs = ['pos', 'process', 'ready', 'tables', 'delivery', 'kitchen', 'more'];
    mobTabs.forEach(t => {
        const mobBtn = document.getElementById(`mob-nav-${t}`);
        if (mobBtn) {
            mobBtn.classList.remove('text-blue-500', 'text-amber-400', 'text-emerald-400');
            mobBtn.classList.add('text-slate-400');
        }
    });

    // Actualizar switcher móvil superior en catálogo
    const topMobPos = document.getElementById('mob-top-tab-pos');
    const topMobProc = document.getElementById('mob-top-tab-process');
    const topMobReady = document.getElementById('mob-top-tab-ready');
    if (topMobPos) {
        if (viewName === 'pos') {
            topMobPos.className = 'flex-1 py-2 px-2 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition bg-blue-600 text-white shadow-sm';
            if (topMobProc) topMobProc.className = 'flex-1 py-2 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition text-slate-400 hover:text-slate-200';
            if (topMobReady) topMobReady.className = 'flex-1 py-2 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition text-slate-400 hover:text-slate-200';
        } else {
            topMobPos.className = 'flex-1 py-2 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition text-slate-400 hover:text-slate-200';
        }
    }

    if (viewName === 'pos') {
        const activeMobNav = document.getElementById('mob-nav-pos');
        if (activeMobNav) {
            activeMobNav.classList.remove('text-slate-400');
            activeMobNav.classList.add('text-blue-500');
        }
    } else {
        const activeMobNav = document.getElementById(`mob-nav-${viewName}`);
        if (activeMobNav) {
            activeMobNav.classList.remove('text-slate-400');
            activeMobNav.classList.add('text-blue-500');
        }
    }

    // Cerrar menú móvil o comanda móvil si se navega a otra sección
    closeMobileMoreMenu();
    closeMobileCartModal();

    // Ocultar todas las secciones
    const views = ['pos', 'orders-status', 'tables', 'delivery', 'kitchen', 'cash', 'inventory', 'customers', 'reports', 'settings'];
    views.forEach(v => {
        const el = document.getElementById(`view-${v}`);
        if (el) el.classList.add('hidden');
    });

    // Mostrar sección seleccionada
    const currentViewEl = document.getElementById(`view-${viewName}`);
    if (currentViewEl) {
        currentViewEl.classList.remove('hidden');
    }

    // Cargar datos correspondientes
    switch (viewName) {
        case 'pos':
            renderPosCategories();
            renderPosProducts();
            break;
        case 'orders-status':
            loadOrdersLiveStatus();
            State.ordersLiveInterval = setInterval(loadOrdersLiveStatus, 5000);
            break;
        case 'tables':
            loadTables();
            break;
        case 'delivery':
            loadDeliveryOrders();
            break;
        case 'kitchen':
            loadKitchenOrders();
            // Polling en vivo para el monitor KDS cada 5 segundos
            State.kdsInterval = setInterval(loadKitchenOrders, 5000);
            break;
        case 'cash':
            loadCashShift();
            break;
        case 'inventory':
            loadInventoryProducts();
            break;
        case 'customers':
            loadCustomers();
            break;
        case 'reports':
            loadReportsData();
            if (State.currentUser?.role === 'admin') {
                State.monitoringInterval = setInterval(loadLiveMonitoringData, 5000);
            }
            break;
        case 'settings':
            loadSettingsForm();
            break;
    }

    if (window.lucide) {
        lucide.createIcons();
    }
}

// ==================== CONFIGURACIÓN Y SERVICIO ====================
async function loadConfig() {
    try {
        const res = await fetch('/api/config');
        const data = await res.json();
        State.config = Object.assign(State.config, data);

        // Actualizar textos en cabecera y login
        const titleEl = document.getElementById('header-business-name');
        const subEl = document.getElementById('header-business-sub');
        const loginTitleEl = document.getElementById('login-screen-title');
        if (titleEl) titleEl.textContent = State.config.business_name || 'Bien Correntino';
        if (subEl) subEl.textContent = State.config.business_subtitle || 'Punto de Venta & Gastronomía';
        if (loginTitleEl) loginTitleEl.textContent = 'biencorrentino';

        // Sincronizar logos en la app
        const logoUrl = State.config.logo_url || '/static/img/logo.png';
        document.querySelectorAll('.app-business-logo').forEach(img => {
            img.src = logoUrl;
        });
    } catch (e) {
        console.error('Error cargando configuración:', e);
    }
}

function formatMoney(amount) {
    const num = parseFloat(amount) || 0;
    const curr = State.config.currency || '$';
    return `${curr}${num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ==================== PRODUCTOS Y CATEGORÍAS ====================
async function loadCategories() {
    try {
        const res = await fetch('/api/categories');
        State.categories = await res.json();
    } catch (e) {
        console.error('Error cargando categorías:', e);
    }
}

async function loadProducts() {
    try {
        const res = await fetch('/api/products');
        State.products = await res.json();
        updateBadges();
    } catch (e) {
        console.error('Error cargando productos:', e);
    }
}

function updateBadges() {
    // Alerta de stock bajo en sidebar
    const lowStockCount = State.products.filter(p => p.control_stock === 1 && p.stock <= p.min_stock).length;
    const badgeLow = document.getElementById('badge-low-stock');
    if (badgeLow) {
        if (lowStockCount > 0) {
            badgeLow.textContent = lowStockCount;
            badgeLow.classList.remove('hidden');
        } else {
            badgeLow.classList.add('hidden');
        }
    }
}

// ==================== POS MOSTRADOR ====================
function renderPosCategories() {
    const container = document.getElementById('pos-categories-list');
    if (!container) return;

    let html = `
        <button onclick="setCategoryFilter(null)" class="px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 ${
            State.activeCategoryFilter === null ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
        }">
            <i data-lucide="grid" class="w-3.5 h-3.5"></i>
            <span>Todos</span>
        </button>
    `;

    State.categories.forEach(cat => {
        const isActive = State.activeCategoryFilter === cat.id;
        html += `
            <button onclick="setCategoryFilter(${cat.id})" class="px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 ${
                isActive ? 'text-white shadow-sm' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }" style="${isActive ? `background-color: ${cat.color || '#3B82F6'}` : ''}">
                <span class="w-2 h-2 rounded-full" style="background-color: ${cat.color || '#3B82F6'}"></span>
                <span>${cat.name}</span>
            </button>
        `;
    });

    if (State.currentUser?.role === 'admin') {
        html += `
            <button onclick="openCategoryManagerModal()" class="admin-only px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200" title="Crear o eliminar categorías">
                <i data-lucide="settings-2" class="w-3.5 h-3.5"></i>
                <span>Categorías</span>
            </button>
        `;
    }

    container.innerHTML = html;
    if (window.lucide) lucide.createIcons();
}

function setCategoryFilter(catId) {
    State.activeCategoryFilter = catId;
    renderPosCategories();
    renderPosProducts();
}

function clearPosSearch() {
    const s = document.getElementById('pos-search-input');
    if (s) {
        s.value = '';
        document.getElementById('pos-search-clear').classList.add('hidden');
        renderPosProducts();
    }
}

function renderPosProducts() {
    const grid = document.getElementById('pos-products-grid');
    const searchVal = (document.getElementById('pos-search-input')?.value || '').trim().toLowerCase();
    const clearBtn = document.getElementById('pos-search-clear');
    if (clearBtn) {
        if (searchVal) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
    }

    let filtered = State.products;
    if (State.activeCategoryFilter !== null) {
        filtered = filtered.filter(p => p.category_id === State.activeCategoryFilter);
    }
    if (searchVal) {
        filtered = filtered.filter(p => 
            p.name.toLowerCase().includes(searchVal) || 
            (p.code && p.code.toLowerCase().includes(searchVal))
        );
    }

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full py-12 text-center text-slate-400">
                <i data-lucide="package-search" class="w-10 h-10 mx-auto text-slate-300 stroke-1 mb-2"></i>
                <p class="text-sm font-medium text-slate-500">No se encontraron productos</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    grid.innerHTML = filtered.map(prod => {
        const isLowStock = prod.control_stock === 1 && prod.stock <= prod.min_stock;
        const isOutOfStock = prod.control_stock === 1 && prod.stock <= 0;
        const isPromo = prod.category_id === 9 || 
                        (prod.category_name && prod.category_name.toLowerCase().includes('promo')) || 
                        prod.name.toLowerCase().includes('promo') || 
                        prod.name.toLowerCase().includes('combo');
        const hasImage = !!(prod.image_url && prod.image_url.trim());

        return `
            <div onclick="addToCartById(${prod.id})" 
                class="pos-touch-btn cursor-pointer bg-white rounded-2xl p-3 border border-slate-200 hover:border-blue-400 hover:shadow-lg transition-all duration-150 flex flex-col justify-between relative group active:scale-[0.98] ${
                    isOutOfStock ? 'opacity-60' : ''
                }">
                
                ${hasImage ? `
                    <div class="w-full h-32 mb-2 rounded-xl overflow-hidden bg-slate-100 relative flex items-center justify-center border border-slate-100 group/img">
                        <img src="${prod.image_url}" alt="${prod.name}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" onerror="this.parentElement.style.display='none'">
                        ${isPromo ? `
                            <span class="absolute top-2 left-2 bg-gradient-to-r from-amber-500 to-rose-500 text-white font-black text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full shadow-md flex items-center gap-1">
                                ⭐ PROMO
                            </span>
                        ` : ''}
                        <button type="button" onclick="event.stopPropagation(); openQuickPhotoModal(${prod.id})" title="Cambiar Foto" class="absolute top-2 right-2 w-7 h-7 rounded-xl bg-slate-900/80 hover:bg-blue-600 text-white flex items-center justify-center transition shadow-md active:scale-90 z-10">
                            <i data-lucide="camera" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                ` : `
                    <div class="w-full h-24 mb-2 rounded-xl bg-slate-50 hover:bg-blue-50/70 border-2 border-dashed border-slate-200 hover:border-blue-400 flex flex-col items-center justify-center relative transition group/cam cursor-pointer" onclick="event.stopPropagation(); openQuickPhotoModal(${prod.id})" title="Toca aquí para cargar la foto">
                        ${isPromo ? `
                            <span class="absolute top-1.5 left-1.5 bg-gradient-to-r from-amber-500 to-rose-500 text-white font-black text-[8px] uppercase tracking-wider px-2 py-0.2 rounded-full shadow-xs flex items-center gap-0.5">
                                ⭐ PROMO
                            </span>
                        ` : ''}
                        <div class="w-8 h-8 rounded-full bg-white shadow-xs border border-slate-200 text-slate-400 group-hover/cam:text-blue-600 group-hover/cam:border-blue-300 flex items-center justify-center transition mb-1">
                            <i data-lucide="camera" class="w-4 h-4"></i>
                        </div>
                        <span class="text-[10px] font-bold text-slate-500 group-hover/cam:text-blue-600 transition flex items-center gap-1">
                            <span>+ Cargar Foto</span>
                        </span>
                    </div>
                `}

                <div class="space-y-1">
                    <div class="flex items-center justify-between text-[11px] text-slate-400">
                        <span class="font-mono">${prod.code || ''}</span>
                        ${prod.control_stock === 1 ? `
                            <span class="px-1.5 py-0.5 rounded font-bold ${
                                isOutOfStock ? 'bg-rose-100 text-rose-700' :
                                isLowStock ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                            }">Stock: ${prod.stock}</span>
                        ` : ''}
                    </div>
                    <h3 class="font-bold text-slate-800 text-sm line-clamp-2 leading-tight">${prod.name}</h3>
                </div>
                <div class="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between">
                    <span class="text-base font-black text-blue-600 tracking-tight">${formatMoney(prod.sale_price)}</span>
                    <button class="w-7 h-7 rounded-xl bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white flex items-center justify-center transition shadow-sm">
                        <i data-lucide="plus" class="w-4 h-4"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

function addToCartById(prodId) {
    const prod = State.products.find(p => p.id === prodId);
    if (prod) addToCart(prod);
}

function addToCart(product) {
    const existing = State.currentCart.items.find(i => i.product_id === product.id);
    if (existing) {
        existing.quantity += 1;
        existing.subtotal = existing.quantity * existing.price;
    } else {
        State.currentCart.items.push({
            product_id: product.id,
            code: product.code,
            name: product.name,
            price: product.sale_price,
            quantity: 1,
            notes: '',
            subtotal: product.sale_price
        });
    }
    renderCart();
}

function updateCartItemQty(index, delta) {
    const item = State.currentCart.items[index];
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) {
        State.currentCart.items.splice(index, 1);
    } else {
        item.subtotal = item.quantity * item.price;
    }
    renderCart();
}

function removeCartItem(index) {
    State.currentCart.items.splice(index, 1);
    renderCart();
}

function editCartItemNote(index) {
    const item = State.currentCart.items[index];
    if (!item) return;
    const note = prompt(`Nota de cocina para "${item.name}":`, item.notes || '');
    if (note !== null) {
        item.notes = note.trim();
        renderCart();
    }
}

function clearCurrentCart() {
    if (State.currentCart.items.length === 0) return;
    State.currentCart.items = [];
    State.currentCart.discountPercent = 0;
    State.currentCart.surchargeAmount = 0;
    const discInput = document.getElementById('pos-discount-input');
    const surInput = document.getElementById('pos-surcharge-input');
    if (discInput) discInput.value = '';
    if (surInput) surInput.value = '';
    renderCart();
}

function renderCart() {
    const container = document.getElementById('pos-cart-items');
    if (!container) return;

    if (State.currentCart.items.length === 0) {
        container.innerHTML = `
            <div class="h-full flex flex-col items-center justify-center text-slate-400 p-6 text-center">
                <i data-lucide="shopping-basket" class="w-12 h-12 text-slate-300 stroke-1 mb-2"></i>
                <p class="text-sm font-medium text-slate-500">La comanda está vacía</p>
                <p class="text-xs text-slate-400 mt-0.5">Toca o escanea un producto para sumarlo a la venta</p>
            </div>
        `;
        updatePosTotals();
        if (window.lucide) lucide.createIcons();
        return;
    }

    container.innerHTML = State.currentCart.items.map((item, idx) => `
        <div class="py-2 flex items-center justify-between gap-2 group">
            <div class="flex-1 min-w-0">
                <h4 class="font-bold text-xs text-slate-800 truncate">${item.name}</h4>
                <div class="flex items-center gap-2 text-[11px] text-slate-400">
                    <span>${formatMoney(item.price)} c/u</span>
                    ${item.notes ? `<span class="bg-amber-100 text-amber-800 px-1 rounded font-medium">Nota: ${item.notes}</span>` : ''}
                </div>
            </div>
            <!-- Controles de cantidad -->
            <div class="flex items-center gap-1">
                <button onclick="updateCartItemQty(${idx}, -1)" class="w-6 h-6 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center font-bold text-xs transition">-</button>
                <span class="w-6 text-center font-bold text-xs text-slate-800">${item.quantity}</span>
                <button onclick="updateCartItemQty(${idx}, 1)" class="w-6 h-6 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center font-bold text-xs transition">+</button>
            </div>
            <!-- Subtotal & Acciones -->
            <div class="text-right min-w-[70px]">
                <span class="font-black text-xs text-slate-800">${formatMoney(item.subtotal)}</span>
                <div class="flex justify-end gap-1 mt-0.5">
                    <button onclick="editCartItemNote(${idx})" title="Agregar Nota" class="text-slate-400 hover:text-amber-600">
                        <i data-lucide="message-square" class="w-3 h-3"></i>
                    </button>
                    <button onclick="removeCartItem(${idx})" title="Quitar item" class="text-slate-400 hover:text-rose-600">
                        <i data-lucide="x" class="w-3 h-3"></i>
                    </button>
                </div>
            </div>
        </div>
    `).join('');

    updatePosTotals();
    if (window.lucide) lucide.createIcons();
}

function updatePosTotals() {
    const rawSubtotal = State.currentCart.items.reduce((acc, i) => acc + i.subtotal, 0);
    const discPercent = parseFloat(document.getElementById('pos-discount-input')?.value || 0);
    const surcharge = parseFloat(document.getElementById('pos-surcharge-input')?.value || 0);

    const discountAmount = (rawSubtotal * discPercent) / 100;
    const grandTotal = Math.max(0, rawSubtotal - discountAmount + surcharge);

    const subEl = document.getElementById('pos-subtotal');
    const discEl = document.getElementById('pos-discount-amount');
    const surEl = document.getElementById('pos-surcharge-amount');
    const totalEl = document.getElementById('pos-grand-total');
    const checkoutBtn = document.getElementById('pos-btn-checkout');

    if (subEl) subEl.textContent = formatMoney(rawSubtotal);
    if (discEl) discEl.textContent = `-${formatMoney(discountAmount)}`;
    if (surEl) surEl.textContent = `+${formatMoney(surcharge)}`;
    if (totalEl) totalEl.textContent = formatMoney(grandTotal);

    if (checkoutBtn) {
        checkoutBtn.disabled = State.currentCart.items.length === 0;
    }

    // Actualizar barra flotante de carrito móvil (biencorrentino Mobile)
    const mobileCartBar = document.getElementById('mobile-cart-bar');
    const mobileCartCount = document.getElementById('mobile-cart-items-count');
    const mobileCartTotal = document.getElementById('mobile-cart-total-badge');
    const totalItems = State.currentCart.items.reduce((acc, i) => acc + i.quantity, 0);

    if (mobileCartCount) mobileCartCount.textContent = `${totalItems} ${totalItems === 1 ? 'ítem' : 'ítems'}`;
    if (mobileCartTotal) mobileCartTotal.textContent = formatMoney(grandTotal);

    if (mobileCartBar) {
        if (totalItems > 0) {
            mobileCartBar.classList.remove('hidden');
        } else {
            mobileCartBar.classList.add('hidden');
            closeMobileCartModal();
        }
    }
}

// Controladores de Comanda Flotante / Drawer para Smartphones
function openMobileCartModal() {
    const panel = document.getElementById('pos-cart-panel');
    if (panel) {
        panel.classList.remove('hidden');
    }
}

function closeMobileCartModal() {
    const panel = document.getElementById('pos-cart-panel');
    if (panel && window.innerWidth < 768) {
        panel.classList.add('hidden');
    }
}

// Controladores de Menú Rápido Móvil (Bottom Sheet "Más Opciones")
function openMobileMoreMenu() {
    const menu = document.getElementById('modal-mobile-more');
    if (menu) {
        const label = document.getElementById('mobile-menu-user-label');
        if (label && State.currentUser) {
            label.textContent = `${State.currentUser.name} (${State.currentUser.role === 'admin' ? 'Dueño' : 'Empleado'})`;
        }
        menu.classList.remove('hidden');
        if (window.lucide) lucide.createIcons();
    }
}

function closeMobileMoreMenu() {
    const menu = document.getElementById('modal-mobile-more');
    if (menu) {
        menu.classList.add('hidden');
    }
}

// ==================== MODAL DE COBRO (CHECKOUT) ====================
let checkoutSaleData = null;

function openCheckoutModal(customData = null) {
    // Si estamos en mobile, cerramos el drawer del carrito antes de abrir el modal de cobro
    closeMobileCartModal();
    checkoutSaleData = customData; // Si viene de una mesa o delivery
    const modal = document.getElementById('modal-checkout');
    const totalDisplay = document.getElementById('checkout-display-total');

    let total = 0;
    if (customData) {
        total = customData.total;
    } else {
        const rawSubtotal = State.currentCart.items.reduce((acc, i) => acc + i.subtotal, 0);
        const discPercent = parseFloat(document.getElementById('pos-discount-input')?.value || 0);
        const surcharge = parseFloat(document.getElementById('pos-surcharge-input')?.value || 0);
        total = Math.max(0, rawSubtotal - (rawSubtotal * discPercent) / 100 + surcharge);
    }

    if (totalDisplay) totalDisplay.textContent = formatMoney(total);

    // Reiniciar método de pago a efectivo
    selectPaymentMethod('cash');
    const cashReceived = document.getElementById('checkout-cash-received');
    if (cashReceived) {
        cashReceived.value = total;
    }
    calculateChange();

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();

    // Auto enfocar el monto
    setTimeout(() => {
        cashReceived?.focus();
        cashReceived?.select();
    }, 100);
}

function closeCheckoutModal() {
    document.getElementById('modal-checkout').classList.add('hidden');
    checkoutSaleData = null;
}

function selectPaymentMethod(method) {
    State.selectedPaymentMethod = method;
    document.querySelectorAll('.payment-method-btn').forEach(btn => {
        btn.classList.remove('border-2', 'border-blue-600', 'bg-blue-50', 'text-blue-700');
        btn.classList.add('border', 'border-slate-200', 'text-slate-700');
    });

    const activeBtn = document.getElementById(`pay-btn-${method}`);
    if (activeBtn) {
        activeBtn.classList.add('border-2', 'border-blue-600', 'bg-blue-50', 'text-blue-700');
        activeBtn.classList.remove('border-slate-200');
    }

    const cashPanel = document.getElementById('checkout-cash-panel');
    if (cashPanel) {
        if (method === 'cash') cashPanel.classList.remove('hidden');
        else cashPanel.classList.add('hidden');
    }
}

function calculateChange() {
    let total = 0;
    if (checkoutSaleData) {
        total = checkoutSaleData.total;
    } else {
        const rawSubtotal = State.currentCart.items.reduce((acc, i) => acc + i.subtotal, 0);
        const discPercent = parseFloat(document.getElementById('pos-discount-input')?.value || 0);
        const surcharge = parseFloat(document.getElementById('pos-surcharge-input')?.value || 0);
        total = Math.max(0, rawSubtotal - (rawSubtotal * discPercent) / 100 + surcharge);
    }

    const received = parseFloat(document.getElementById('checkout-cash-received')?.value || 0);
    const change = Math.max(0, received - total);
    const changeDisplay = document.getElementById('checkout-change-display');
    if (changeDisplay) {
        changeDisplay.textContent = formatMoney(change);
    }
}

function setFastCash(val) {
    let total = 0;
    if (checkoutSaleData) {
        total = checkoutSaleData.total;
    } else {
        const rawSubtotal = State.currentCart.items.reduce((acc, i) => acc + i.subtotal, 0);
        const discPercent = parseFloat(document.getElementById('pos-discount-input')?.value || 0);
        const surcharge = parseFloat(document.getElementById('pos-surcharge-input')?.value || 0);
        total = Math.max(0, rawSubtotal - (rawSubtotal * discPercent) / 100 + surcharge);
    }

    const cashInput = document.getElementById('checkout-cash-received');
    if (val === 'exact') {
        cashInput.value = total;
    } else {
        const current = parseFloat(cashInput.value || 0);
        cashInput.value = current + val;
    }
    calculateChange();
}

async function processCheckoutSale() {
    let payload = {};

    if (checkoutSaleData) {
        // Cobro de mesa o delivery existente
        payload = {
            order_id: checkoutSaleData.order_id,
            table_id: checkoutSaleData.table_id,
            subtotal: checkoutSaleData.subtotal,
            total: checkoutSaleData.total,
            discount_percent: 0,
            discount_amount: 0,
            surcharge_amount: 0,
            payment_method: State.selectedPaymentMethod,
            amount_paid: parseFloat(document.getElementById('checkout-cash-received')?.value || checkoutSaleData.total),
            change_returned: Math.max(0, (parseFloat(document.getElementById('checkout-cash-received')?.value || checkoutSaleData.total) - checkoutSaleData.total))
        };
    } else {
        // Venta directa de mostrador
        const rawSubtotal = State.currentCart.items.reduce((acc, i) => acc + i.subtotal, 0);
        const discPercent = parseFloat(document.getElementById('pos-discount-input')?.value || 0);
        const surcharge = parseFloat(document.getElementById('pos-surcharge-input')?.value || 0);
        const discountAmount = (rawSubtotal * discPercent) / 100;
        const grandTotal = Math.max(0, rawSubtotal - discountAmount + surcharge);

        const received = parseFloat(document.getElementById('checkout-cash-received')?.value || grandTotal);
        const change = Math.max(0, received - grandTotal);

        payload = {
            order_type: 'counter',
            items: State.currentCart.items,
            customer_id: State.currentCart.customerId,
            customer_name: State.currentCart.customerName,
            subtotal: rawSubtotal,
            discount_percent: discPercent,
            discount_amount: discountAmount,
            surcharge_amount: surcharge,
            total: grandTotal,
            payment_method: State.selectedPaymentMethod,
            amount_paid: received,
            change_returned: change
        };
    }

    try {
        const res = await fetch('/api/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.status === 'ok') {
            closeCheckoutModal();
            if (!checkoutSaleData) {
                clearCurrentCart();
            }
            // Recargar catálogo y turnos
            await loadProducts();
            await checkCurrentShift();
            // Mostrar ticket térmico
            showThermalTicket(data.order);
        } else {
            alert(data.error || 'Error al procesar el cobro');
        }
    } catch (e) {
        console.error('Error en checkout:', e);
        alert('Error al comunicar con el servidor');
    }
}

// ==================== TICKET TÉRMICO (58mm / 80mm) ====================
function showThermalTicket(order) {
    const modal = document.getElementById('modal-ticket');
    const container = document.getElementById('thermal-ticket-print');

    const dateStr = new Date(order.closed_at || order.created_at).toLocaleString('es-AR');
    const methodNames = {
        'cash': 'Efectivo',
        'card_debit': 'Tarjeta Débito',
        'card_credit': 'Tarjeta Crédito',
        'transfer': 'QR / Transferencia',
        'credit': 'Cuenta Corriente (Fiado)'
    };

    let itemsHtml = (order.items || []).map(it => `
        <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
            <span>${it.quantity}x ${it.product_name}</span>
            <span>${formatMoney(it.subtotal)}</span>
        </div>
        ${it.notes ? `<div style="font-size: 10px; color: #555; padding-left: 8px;">* ${it.notes}</div>` : ''}
    `).join('');

    container.innerHTML = `
        <div style="text-align: center; margin-bottom: 8px;">
            <img src="${State.config.logo_url || '/static/img/logo.png'}" alt="Logo" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover; margin: 0 auto 4px auto; display: block; border: 1px solid #ccc;">
            <div style="font-size: 14px; font-weight: bold; text-transform: uppercase;">${State.config.business_name || 'Bien Correntino'}</div>
            <div style="font-size: 10px;">${State.config.business_subtitle || ''}</div>
            <div style="font-size: 10px;">CUIT: ${State.config.cuit || 'S/D'}</div>
            <div style="font-size: 10px;">${State.config.address || ''}</div>
            <div style="font-size: 10px;">Tel: ${State.config.phone || ''}</div>
        </div>

        <div style="border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 4px 0; margin: 6px 0; font-size: 11px;">
            <div>Ticket #${order.id} | ${dateStr}</div>
            <div>Tipo: ${order.order_type === 'table' ? `Mesa (${order.table_id})` : order.order_type === 'delivery' ? 'Delivery' : 'Mostrador'}</div>
            ${order.customer_name ? `<div>Cliente: ${order.customer_name}</div>` : ''}
        </div>

        <div style="margin: 8px 0; font-size: 11px;">
            ${itemsHtml}
        </div>

        <div style="border-top: 1px dashed #000; padding-top: 6px; font-size: 11px;">
            <div style="display: flex; justify-content: space-between;">
                <span>Subtotal:</span>
                <span>${formatMoney(order.subtotal)}</span>
            </div>
            ${order.discount_amount > 0 ? `
                <div style="display: flex; justify-content: space-between; color: #16a34a;">
                    <span>Descuento:</span>
                    <span>-${formatMoney(order.discount_amount)}</span>
                </div>
            ` : ''}
            ${order.surcharge_amount > 0 ? `
                <div style="display: flex; justify-content: space-between;">
                    <span>Recargo:</span>
                    <span>+${formatMoney(order.surcharge_amount)}</span>
                </div>
            ` : ''}
            <div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: bold; margin-top: 4px;">
                <span>TOTAL:</span>
                <span>${formatMoney(order.total)}</span>
            </div>
        </div>

        <div style="border-top: 1px dashed #000; margin-top: 6px; padding-top: 4px; font-size: 10px;">
            <div>Medio de pago: ${methodNames[order.payment_method] || order.payment_method}</div>
            ${order.amount_paid ? `<div>Monto abonado: ${formatMoney(order.amount_paid)}</div>` : ''}
            ${order.change_returned > 0 ? `<div>Vuelto: ${formatMoney(order.change_returned)}</div>` : ''}
        </div>

        <div style="text-align: center; margin-top: 12px; font-size: 10px; white-space: pre-line;">
            ${State.config.ticket_footer || '¡Muchas gracias por su compra!'}
        </div>
    `;

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}

function closeTicketModal() {
    document.getElementById('modal-ticket').classList.add('hidden');
}

// ==================== MESAS & SALÓN ====================
let activeTableData = null;

async function loadTables() {
    try {
        const res = await fetch('/api/tables');
        const sectors = await res.json();
        renderTablesView(sectors);
    } catch (e) {
        console.error('Error cargando mesas:', e);
    }
}

function renderTablesView(sectors) {
    const tabsContainer = document.getElementById('tables-sectors-tabs');
    const gridContainer = document.getElementById('tables-grid');
    if (!sectors || sectors.length === 0) return;

    // Pestañas de sectores
    tabsContainer.innerHTML = sectors.map((s, idx) => `
        <button onclick="filterSector(${s.id})" id="sector-tab-${s.id}" class="sector-tab-btn px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
            idx === 0 ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
        }">
            ${s.name}
        </button>
    `).join('');

    // Todas las mesas
    let allTables = [];
    sectors.forEach(s => {
        allTables = allTables.concat(s.tables || []);
    });

    // Actualizar badge de mesas ocupadas (Desktop y Mobile)
    const busyCount = allTables.filter(t => t.status === 'busy' || t.status === 'billing').length;
    const badge = document.getElementById('badge-busy-tables');
    const mobBadge = document.getElementById('mob-badge-busy-tables');

    if (badge) {
        if (busyCount > 0) {
            badge.textContent = busyCount;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
    if (mobBadge) {
        if (busyCount > 0) {
            mobBadge.textContent = busyCount;
            mobBadge.classList.remove('hidden');
        } else {
            mobBadge.classList.add('hidden');
        }
    }

    renderTablesGrid(sectors[0]?.id || null, sectors);
}

function filterSector(sectorId) {
    document.querySelectorAll('.sector-tab-btn').forEach(b => {
        b.classList.remove('bg-blue-600', 'text-white', 'shadow-sm');
        b.classList.add('bg-slate-100', 'hover:bg-slate-200', 'text-slate-700');
    });
    const tab = document.getElementById(`sector-tab-${sectorId}`);
    if (tab) {
        tab.classList.add('bg-blue-600', 'text-white', 'shadow-sm');
        tab.classList.remove('bg-slate-100', 'text-slate-700');
    }

    fetch('/api/tables').then(r => r.json()).then(sectors => {
        renderTablesGrid(sectorId, sectors);
    });
}

function renderTablesGrid(sectorId, sectors) {
    const grid = document.getElementById('tables-grid');
    const sector = sectors.find(s => s.id === sectorId) || sectors[0];
    if (!sector || !sector.tables) return;

    grid.innerHTML = sector.tables.map(t => {
        const isBusy = t.status === 'busy';
        const isBilling = t.status === 'billing';

        let statusClass = 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:border-emerald-500';
        let badgeColor = 'bg-emerald-500';
        let statusText = 'Libre';

        if (isBusy) {
            statusClass = 'bg-rose-50 border-rose-300 text-rose-900 hover:border-rose-500';
            badgeColor = 'bg-rose-500';
            statusText = 'Ocupada';
        } else if (isBilling) {
            statusClass = 'bg-amber-50 border-amber-300 text-amber-900 hover:border-amber-500';
            badgeColor = 'bg-amber-400';
            statusText = 'Cuenta Pedida';
        }

        return `
            <div onclick="handleTableClick(${t.id}, '${t.status}')" 
                class="pos-touch-btn cursor-pointer rounded-2xl p-4 border-2 ${statusClass} shadow-sm transition flex flex-col justify-between h-36 relative">
                <div>
                    <div class="flex items-center justify-between">
                        <span class="font-black text-lg text-slate-800">${t.number}</span>
                        <span class="flex items-center gap-1.5 text-[11px] font-bold">
                            <span class="w-2 h-2 rounded-full ${badgeColor}"></span>
                            <span>${statusText}</span>
                        </span>
                    </div>
                    <div class="text-xs text-slate-500 mt-1 flex items-center gap-1">
                        <i data-lucide="users" class="w-3.5 h-3.5"></i>
                        <span>Cap: ${t.capacity}</span>
                    </div>
                </div>

                <div>
                    ${(isBusy || isBilling) ? `
                        <div class="pt-2 border-t border-slate-200/60 flex items-center justify-between">
                            <span class="text-[11px] text-slate-500">${t.item_count || 0} platos</span>
                            <span class="text-sm font-black text-slate-900">${formatMoney(t.order_total || 0)}</span>
                        </div>
                    ` : `
                        <div class="pt-2 border-t border-slate-200/60 text-center">
                            <span class="text-xs text-emerald-600 font-bold">+ Abrir Mesa</span>
                        </div>
                    `}
                </div>
            </div>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

let tableIdToOpen = null;

function handleTableClick(tableId, status) {
    if (status === 'free') {
        tableIdToOpen = tableId;
        document.getElementById('modal-open-table').classList.remove('hidden');
    } else {
        openTableOrderModal(tableId);
    }
}

function closeOpenTableModal() {
    document.getElementById('modal-open-table').classList.add('hidden');
    tableIdToOpen = null;
}

async function confirmOpenTable() {
    if (!tableIdToOpen) return;
    const waiter = document.getElementById('open-table-waiter')?.value || 'Mozo 1';
    const diners = parseInt(document.getElementById('open-table-diners')?.value || 2);

    try {
        const res = await fetch(`/api/tables/${tableIdToOpen}/open`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ waiter_name: waiter, diners_count: diners })
        });
        const data = await res.json();
        if (data.status === 'ok') {
            closeOpenTableModal();
            await loadTables();
            openTableOrderModal(tableIdToOpen);
        }
    } catch (e) {
        console.error('Error abriendo mesa:', e);
    }
}

async function openTableOrderModal(tableId) {
    try {
        const res = await fetch(`/api/tables/${tableId}/order`);
        const data = await res.json();
        activeTableData = data;

        const modal = document.getElementById('modal-table-order');
        const title = document.getElementById('table-order-modal-title');
        const subtitle = document.getElementById('table-order-modal-subtitle');
        const tbody = document.getElementById('table-items-tbody');
        const totalEl = document.getElementById('table-order-total-display');

        title.innerHTML = `<i data-lucide="coffee" class="w-5 h-5 text-blue-600"></i> <span>${data.table.name || data.table.number}</span>`;
        subtitle.textContent = `Mozo: ${data.order?.waiter_name || 'S/D'} • ${data.order?.diners_count || 1} comensales`;

        // Renderizar items pedidos
        const items = data.order?.items || [];
        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-400">Sin consumiciones cargadas</td></tr>`;
        } else {
            tbody.innerHTML = items.map(it => `
                <tr class="hover:bg-slate-50">
                    <td class="p-2.5 font-bold text-center">${it.quantity}</td>
                    <td class="p-2.5 font-medium text-slate-800">${it.product_name}</td>
                    <td class="p-2.5 text-slate-500">${it.notes || '-'}</td>
                    <td class="p-2.5 text-right font-mono">${formatMoney(it.unit_price)}</td>
                    <td class="p-2.5 text-right font-bold font-mono text-slate-900">${formatMoney(it.subtotal)}</td>
                </tr>
            `).join('');
        }

        totalEl.textContent = formatMoney(data.order?.total || 0);

        // Llenar selector de productos para agregar platos
        const prodSelect = document.getElementById('table-add-product-select');
        if (prodSelect) {
            prodSelect.innerHTML = State.products.map(p => `
                <option value="${p.id}">${p.name} - ${formatMoney(p.sale_price)}</option>
            `).join('');
        }

        modal.classList.remove('hidden');
        if (window.lucide) lucide.createIcons();
    } catch (e) {
        console.error('Error cargando comanda de mesa:', e);
    }
}

function closeTableOrderModal() {
    document.getElementById('modal-table-order').classList.add('hidden');
    activeTableData = null;
    loadTables();
}

async function addItemToCurrentTable() {
    if (!activeTableData || !activeTableData.table) return;
    const prodId = parseInt(document.getElementById('table-add-product-select')?.value);
    const qty = parseFloat(document.getElementById('table-add-product-qty')?.value || 1);
    const note = document.getElementById('table-add-product-note')?.value || '';

    const prod = State.products.find(p => p.id === prodId);
    if (!prod) return;

    try {
        const res = await fetch(`/api/tables/${activeTableData.table.id}/add_items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: [{
                    product_id: prod.id,
                    name: prod.name,
                    price: prod.sale_price,
                    quantity: qty,
                    notes: note
                }]
            })
        });
        const d = await res.json();
        if (d.status === 'ok') {
            document.getElementById('table-add-product-note').value = '';
            document.getElementById('table-add-product-qty').value = '1';
            openTableOrderModal(activeTableData.table.id);
        }
    } catch (e) {
        console.error('Error agregando item a mesa:', e);
    }
}

async function requestTableBill() {
    if (!activeTableData || !activeTableData.table) return;
    await fetch(`/api/tables/${activeTableData.table.id}/bill`, { method: 'POST' });
    closeTableOrderModal();
    loadTables();
}

function checkoutCurrentTable() {
    if (!activeTableData || !activeTableData.order) return;
    const ord = activeTableData.order;
    const table = activeTableData.table;
    closeTableOrderModal();

    openCheckoutModal({
        order_id: ord.id,
        table_id: table.id,
        subtotal: ord.total,
        total: ord.total
    });
}

// ==================== MONITOR DE COCINA (KDS) ====================
async function loadKitchenOrders() {
    try {
        const res = await fetch('/api/kitchen');
        const orders = await res.json();
        renderKitchenView(orders);
    } catch (e) {
        console.error('Error cargando comandas de cocina:', e);
    }
}

function renderKitchenView(orders) {
    const grid = document.getElementById('kitchen-orders-grid');
    const badge = document.getElementById('badge-kitchen-orders');
    const mobBadge = document.getElementById('mob-badge-kitchen');

    if (badge) {
        if (orders.length > 0) {
            badge.textContent = orders.length;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
    if (mobBadge) {
        if (orders.length > 0) {
            mobBadge.textContent = orders.length;
            mobBadge.classList.remove('hidden');
        } else {
            mobBadge.classList.add('hidden');
        }
    }

    if (!grid) return;
    if (orders.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full py-20 text-center text-slate-500">
                <i data-lucide="check-circle-2" class="w-16 h-16 mx-auto text-emerald-500 stroke-1 mb-3"></i>
                <p class="text-base font-bold text-slate-300">¡Cocina al día!</p>
                <p class="text-xs text-slate-500 mt-1">No hay comandas pendientes de despacho</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    grid.innerHTML = orders.map(ord => {
        const orderTime = new Date(ord.created_at);
        const minsElapsed = Math.floor((new Date() - orderTime) / 60000);

        let urgencyClass = 'kitchen-card-normal';
        let badgeColor = 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
        if (minsElapsed >= 20) {
            urgencyClass = 'kitchen-card-urgent';
            badgeColor = 'bg-red-500/20 text-red-400 border-red-500/30';
        } else if (minsElapsed >= 10) {
            urgencyClass = 'kitchen-card-warn';
            badgeColor = 'bg-amber-500/20 text-amber-400 border-amber-500/30';
        }

        return `
            <div class="bg-slate-800 rounded-2xl p-4 border border-slate-700 flex flex-col justify-between shadow-lg ${urgencyClass}">
                <div>
                    <div class="flex items-center justify-between pb-2 border-b border-slate-700">
                        <span class="font-black text-white text-base">
                            ${ord.order_type === 'table' ? (ord.table_name || `Mesa ${ord.table_number}`) : ord.order_type === 'delivery' ? `🛵 Delivery: ${ord.customer_name || 'Cliente'}` : `🛍️ Retiro: ${ord.customer_name || 'Cliente'}`}
                        </span>
                        <span class="text-xs font-mono font-bold px-2 py-0.5 rounded-full border ${badgeColor}">
                            ${minsElapsed} min
                        </span>
                    </div>

                    <div class="py-1 text-[11px] text-slate-400 space-y-0.5">
                        <div class="flex items-center justify-between">
                            <span>Ticket #${ord.id}</span>
                            ${ord.payment_method ? `<span class="font-bold text-amber-400 uppercase">💳 ${ord.payment_method === 'cash' ? 'Efectivo' : ord.payment_method === 'transfer' ? 'QR/Transf.' : 'Tarjeta'}</span>` : ''}
                        </div>
                        ${ord.waiter_name ? `<div>• Mozo: ${ord.waiter_name}</div>` : ''}
                        ${ord.delivery_address && ord.order_type === 'delivery' ? `<div class="text-blue-300 font-medium">📍 ${ord.delivery_address}</div>` : ''}
                        ${ord.customer_phone ? `<div>📞 Tel: ${ord.customer_phone}</div>` : ''}
                    </div>

                    <div class="my-3 space-y-2">
                        ${ord.items.map(it => `
                            <div onclick="toggleKitchenItemStatus(${it.id}, '${it.status}')" class="cursor-pointer p-2 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-slate-700/50 flex items-start justify-between gap-2 transition">
                                <div class="flex items-start gap-2">
                                    <span class="font-bold text-amber-400 text-sm">${it.quantity}x</span>
                                    <div>
                                        <span class="text-xs font-medium text-slate-200 ${it.status === 'cooking' ? 'text-amber-300' : ''}">${it.product_name}</span>
                                        ${it.notes ? `<div class="text-[11px] text-rose-400 font-bold mt-0.5">⚠️ ${it.notes}</div>` : ''}
                                    </div>
                                </div>
                                <span class="text-[10px] px-1.5 py-0.5 rounded ${
                                    it.status === 'cooking' ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-700 text-slate-400'
                                }">${it.status === 'cooking' ? 'En cocción' : 'Pendiente'}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <button onclick="markKitchenOrderReady(${ord.id})" class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow transition">
                    <i data-lucide="check" class="w-4 h-4"></i>
                    <span>Completar Comanda</span>
                </button>
            </div>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

async function toggleKitchenItemStatus(itemId, currentStatus) {
    const nextStatus = currentStatus === 'pending' ? 'cooking' : 'ready';
    await fetch(`/api/kitchen/item/${itemId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
    });
    loadKitchenOrders();
}

async function markKitchenOrderReady(orderId) {
    await fetch(`/api/kitchen/order/${orderId}/ready`, { method: 'POST' });
    loadKitchenOrders();
}

// ==================== DELIVERY & TAKE AWAY ====================
async function loadDeliveryOrders() {
    try {
        const res = await fetch('/api/delivery');
        const orders = await res.json();
        renderDeliveryKanban(orders);
    } catch (e) {
        console.error('Error cargando delivery:', e);
    }
}

function renderDeliveryKanban(orders) {
    const colKitchen = document.getElementById('delivery-list-kitchen');
    const colRoad = document.getElementById('delivery-list-road');
    const colDelivered = document.getElementById('delivery-list-delivered');

    const kOrders = orders.filter(o => o.status === 'kitchen' || o.status === 'open');
    const rOrders = orders.filter(o => o.status === 'ready');
    const dOrders = orders.filter(o => o.status === 'paid' || o.status === 'delivered');

    document.getElementById('delivery-count-kitchen').textContent = kOrders.length;
    document.getElementById('delivery-count-road').textContent = rOrders.length;
    document.getElementById('delivery-count-delivered').textContent = dOrders.length;

    // Actualizar badge de delivery activo (Desktop y Mobile)
    const activeDeliveryCount = kOrders.length + rOrders.length;
    const badgeDeliv = document.getElementById('badge-delivery-count');
    const mobBadgeDeliv = document.getElementById('mob-badge-delivery');
    if (badgeDeliv) {
        if (activeDeliveryCount > 0) {
            badgeDeliv.textContent = activeDeliveryCount;
            badgeDeliv.classList.remove('hidden');
        } else {
            badgeDeliv.classList.add('hidden');
        }
    }
    if (mobBadgeDeliv) {
        if (activeDeliveryCount > 0) {
            mobBadgeDeliv.textContent = activeDeliveryCount;
            mobBadgeDeliv.classList.remove('hidden');
        } else {
            mobBadgeDeliv.classList.add('hidden');
        }
    }

    const renderCard = (o, nextAction) => `
        <div class="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm space-y-2">
            <div class="flex items-center justify-between">
                <span class="font-bold text-xs text-slate-800">#${o.id} • ${o.customer_name}</span>
                <span class="font-black text-xs text-blue-600">${formatMoney(o.total)}</span>
            </div>
            <p class="text-xs text-slate-600 flex items-center gap-1">
                <i data-lucide="map-pin" class="w-3.5 h-3.5 text-slate-400"></i>
                <span class="truncate">${o.delivery_address}</span>
            </p>
            ${o.delivery_courier ? `<p class="text-[11px] text-slate-500">Cadete: <strong class="text-slate-700">${o.delivery_courier}</strong></p>` : ''}
            <div class="pt-2 border-t border-slate-100 flex gap-2">
                ${nextAction}
            </div>
        </div>
    `;

    colKitchen.innerHTML = kOrders.map(o => renderCard(o, `
        <button onclick="setDeliveryStatus(${o.id}, 'ready')" class="w-full py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white rounded-lg text-xs font-bold transition">
            Listo / Despachar
        </button>
    `)).join('');

    colRoad.innerHTML = rOrders.map(o => renderCard(o, `
        <button onclick="checkoutDeliveryOrder(${o.id}, ${o.total})" class="w-full py-1.5 bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg text-xs font-bold transition">
            Cobrar y Entregar
        </button>
    `)).join('');

    colDelivered.innerHTML = dOrders.map(o => renderCard(o, `
        <span class="text-[11px] text-emerald-600 font-bold flex items-center gap-1">
            <i data-lucide="check-circle" class="w-3.5 h-3.5"></i> Entregado
        </span>
    `)).join('');

    if (window.lucide) lucide.createIcons();
}

async function setDeliveryStatus(orderId, status) {
    await fetch(`/api/delivery/${orderId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
    });
    loadDeliveryOrders();
}

function checkoutDeliveryOrder(orderId, total) {
    openCheckoutModal({
        order_id: orderId,
        subtotal: total,
        total: total
    });
}

function openNewDeliveryModal() {
    State.activeDeliveryItems = [];
    const select = document.getElementById('deliv-product-select');
    if (select) {
        select.innerHTML = State.products.map(p => `
            <option value="${p.id}">${p.name} (${formatMoney(p.sale_price)})</option>
        `).join('');
    }
    renderDeliveryModalItems();
    document.getElementById('modal-new-delivery').classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}
function closeNewDeliveryModal() {
    document.getElementById('modal-new-delivery').classList.add('hidden');
}

function addDeliveryItem() {
    const prodId = parseInt(document.getElementById('deliv-product-select')?.value);
    const qty = parseFloat(document.getElementById('deliv-product-qty')?.value || 1);
    const prod = State.products.find(p => p.id === prodId);
    if (!prod) return;

    State.activeDeliveryItems.push({
        id: prod.id,
        name: prod.name,
        price: prod.sale_price,
        quantity: qty,
        subtotal: prod.sale_price * qty
    });
    renderDeliveryModalItems();
}

function renderDeliveryModalItems() {
    const list = document.getElementById('deliv-items-list');
    if (!list) return;
    if (State.activeDeliveryItems.length === 0) {
        list.innerHTML = `<p class="text-slate-400 text-center py-2">Sin productos agregados</p>`;
        return;
    }
    list.innerHTML = State.activeDeliveryItems.map((it, idx) => `
        <div class="flex items-center justify-between py-1">
            <span>${it.quantity}x ${it.name}</span>
            <span class="font-bold">${formatMoney(it.subtotal)}</span>
        </div>
    `).join('');
}

async function submitNewDelivery() {
    const name = document.getElementById('deliv-form-name')?.value.trim();
    const phone = document.getElementById('deliv-form-phone')?.value.trim();
    const address = document.getElementById('deliv-form-address')?.value.trim();
    const courier = document.getElementById('deliv-form-courier')?.value.trim();
    const fee = parseFloat(document.getElementById('deliv-form-fee')?.value || 0);

    if (!name || !address) {
        alert('Nombre y dirección son obligatorios');
        return;
    }
    if (State.activeDeliveryItems.length === 0) {
        alert('Debe agregar al menos un producto');
        return;
    }

    const subtotal = State.activeDeliveryItems.reduce((a, b) => a + b.subtotal, 0);

    try {
        const res = await fetch('/api/delivery', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customer_name: name,
                customer_phone: phone,
                delivery_address: address,
                delivery_courier: courier,
                delivery_fee: fee,
                subtotal: subtotal,
                items: State.activeDeliveryItems
            })
        });
        const data = await res.json();
        if (data.status === 'ok') {
            closeNewDeliveryModal();
            loadDeliveryOrders();
        }
    } catch (e) {
        console.error('Error creando pedido de delivery:', e);
    }
}

// ==================== CAJA & TURNOS ====================
async function checkCurrentShift() {
    try {
        const res = await fetch('/api/cash/current');
        const data = await res.json();
        State.currentShift = data.shift;

        const badgeText = document.getElementById('header-shift-text');
        if (badgeText) {
            if (data.status === 'open') {
                badgeText.textContent = `Caja Abierta: #${data.shift.id}`;
            } else {
                badgeText.textContent = 'Caja Cerrada';
            }
        }
    } catch (e) {
        console.error('Error verificando caja:', e);
    }
}

async function loadCashShift() {
    await checkCurrentShift();
    const activeCard = document.getElementById('cash-active-card');
    const actionsContainer = document.getElementById('cash-actions-container');

    if (!State.currentShift) {
        activeCard.innerHTML = `
            <div class="py-12 text-center text-slate-500">
                <i data-lucide="lock" class="w-12 h-12 mx-auto text-amber-500 stroke-1 mb-2"></i>
                <h3 class="font-bold text-base text-slate-700">La caja se encuentra actualmente cerrada</h3>
                <p class="text-xs text-slate-400 mt-1">Abra un nuevo turno con un fondo inicial para registrar operaciones de venta</p>
                <button onclick="openOpenShiftModal()" class="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow transition">
                    + Abrir Turno de Caja
                </button>
            </div>
        `;
        actionsContainer.innerHTML = '';
        if (window.lucide) lucide.createIcons();
        return;
    }

    const s = State.currentShift;
    activeCard.innerHTML = `
        <div class="flex flex-wrap items-center justify-between pb-4 border-b border-slate-100 gap-3">
            <div>
                <span class="text-xs font-bold text-emerald-600 uppercase tracking-wide flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Turno Abierto #${s.id}
                </span>
                <h3 class="font-black text-xl text-slate-800 mt-0.5">Cajero: ${s.cashier_name}</h3>
                <span class="text-xs text-slate-400">Apertura: ${new Date(s.opened_at).toLocaleString('es-AR')}</span>
            </div>
            <div class="text-right">
                <span class="text-xs text-slate-500 font-medium">Efectivo Calculado en Gaveta</span>
                <div class="text-3xl font-black text-emerald-600">${formatMoney(s.expected_cash)}</div>
            </div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
            <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span class="text-slate-500">Fondo Inicial</span>
                <div class="text-base font-bold text-slate-800">${formatMoney(s.initial_cash)}</div>
            </div>
            <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span class="text-slate-500">Ventas Efectivo</span>
                <div class="text-base font-bold text-slate-800">${formatMoney(s.cash_sales)}</div>
            </div>
            <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span class="text-slate-500">Tarjetas (Déb/Créd)</span>
                <div class="text-base font-bold text-slate-800">${formatMoney((s.card_debit || 0) + (s.card_credit || 0))}</div>
            </div>
            <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span class="text-slate-500">QR / Transferencias</span>
                <div class="text-base font-bold text-slate-800">${formatMoney(s.transfer)}</div>
            </div>
        </div>
    `;

    actionsContainer.innerHTML = `
        <button onclick="openCashMovementModal('income')" class="px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-xl text-xs font-bold transition flex items-center gap-1">
            <i data-lucide="arrow-down-left" class="w-3.5 h-3.5"></i> Ingreso
        </button>
        <button onclick="openCashMovementModal('expense')" class="px-3 py-1.5 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-xl text-xs font-bold transition flex items-center gap-1">
            <i data-lucide="arrow-up-right" class="w-3.5 h-3.5"></i> Gasto / Retiro
        </button>
        <button onclick="openShiftCloseModal()" class="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-sm">
            <i data-lucide="lock" class="w-3.5 h-3.5"></i> Cerrar Caja (Arqueo Z)
        </button>
    `;

    // Cargar historial de turnos
    loadCashHistory();
    if (window.lucide) lucide.createIcons();
}

async function loadCashHistory() {
    try {
        const res = await fetch('/api/cash/history');
        const shifts = await res.json();
        const tbody = document.getElementById('cash-history-tbody');
        if (!tbody) return;

        tbody.innerHTML = shifts.map(s => `
            <tr class="hover:bg-slate-50">
                <td class="p-2.5 font-bold">#${s.id}</td>
                <td class="p-2.5 text-slate-700">${s.cashier_name}</td>
                <td class="p-2.5 text-slate-500">${new Date(s.opened_at).toLocaleDateString('es-AR')}</td>
                <td class="p-2.5 text-slate-500">${s.closed_at ? new Date(s.closed_at).toLocaleDateString('es-AR') : 'Abierto'}</td>
                <td class="p-2.5 font-mono">${formatMoney(s.initial_cash)}</td>
                <td class="p-2.5 font-mono font-bold text-slate-900">${formatMoney(s.total_sales)}</td>
                <td class="p-2.5 font-mono">${formatMoney(s.final_cash_real)}</td>
                <td class="p-2.5 font-mono font-bold ${s.difference < 0 ? 'text-rose-600' : s.difference > 0 ? 'text-emerald-600' : 'text-slate-600'}">
                    ${formatMoney(s.difference)}
                </td>
                <td class="p-2.5 text-center">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        s.status === 'open' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                    }">${s.status === 'open' ? 'Abierta' : 'Cerrada'}</span>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        console.error('Error cargando historial de caja:', e);
    }
}

function openOpenShiftModal() {
    const cashier = prompt('Nombre del Cajero / Responsable:', 'Cajero 1');
    if (!cashier) return;
    const initial = prompt('Fondo inicial de efectivo en caja ($):', '25000');
    if (initial === null) return;

    fetch('/api/cash/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cashier_name: cashier, initial_cash: parseFloat(initial) || 0 })
    }).then(r => r.json()).then(d => {
        if (d.status === 'ok') {
            loadCashShift();
        } else {
            alert(d.error);
        }
    });
}

function openCashMovementModal(type) {
    const modal = document.getElementById('modal-cash-movement');
    const sel = document.getElementById('cash-movement-type');
    if (sel) sel.value = type;
    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}
function closeCashMovementModal() {
    document.getElementById('modal-cash-movement').classList.add('hidden');
}

async function submitCashMovement() {
    const type = document.getElementById('cash-movement-type')?.value;
    const amount = parseFloat(document.getElementById('cash-movement-amount')?.value || 0);
    const concept = document.getElementById('cash-movement-concept')?.value.trim();

    if (amount <= 0 || !concept) {
        alert('Complete monto y motivo correctamente');
        return;
    }

    const res = await fetch('/api/cash/movement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, amount, concept })
    });
    const data = await res.json();
    if (data.status === 'ok') {
        closeCashMovementModal();
        loadCashShift();
    } else {
        alert(data.error);
    }
}

function openShiftCloseModal() {
    document.getElementById('modal-close-shift').classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}
function closeShiftModal() {
    document.getElementById('modal-close-shift').classList.add('hidden');
}

async function submitCloseShift() {
    const realCash = parseFloat(document.getElementById('shift-close-real-cash')?.value || 0);
    const notes = document.getElementById('shift-close-notes')?.value.trim();

    const res = await fetch('/api/cash/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ final_cash_real: realCash, notes })
    });
    const data = await res.json();
    if (data.status === 'ok') {
        closeShiftModal();
        loadCashShift();
        alert(`Turno de caja cerrado exitosamente.\nDiferencia: ${formatMoney(data.shift.difference)}`);
    } else {
        alert(data.error);
    }
}

// ==================== INVENTARIO & PRODUCTOS ====================
async function loadInventoryProducts() {
    const q = document.getElementById('inv-search-input')?.value || '';
    const cat = document.getElementById('inv-category-filter')?.value || '';
    const low = document.getElementById('inv-low-stock-check')?.checked ? '1' : '';

    let url = `/api/products?q=${encodeURIComponent(q)}`;
    if (cat) url += `&category_id=${cat}`;
    if (low) url += `&low_stock=1`;

    const res = await fetch(url);
    const products = await res.json();
    renderInventoryTable(products);

    // Llenar selector de categorías si está vacío
    const catSelect = document.getElementById('inv-category-filter');
    if (catSelect && catSelect.options.length <= 1) {
        State.categories.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.name;
            catSelect.appendChild(opt);
        });
    }
}

function renderInventoryTable(products) {
    const tbody = document.getElementById('inventory-tbody');
    if (!tbody) return;

    if (products.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="p-8 text-center text-slate-400">No hay productos que coincidan con la búsqueda</td></tr>`;
        return;
    }

    tbody.innerHTML = products.map(p => {
        const isLowStock = p.control_stock === 1 && p.stock <= p.min_stock;
        const hasImg = !!(p.image_url && p.image_url.trim());
        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-2 text-center">
                    ${hasImg ? `
                        <img src="${p.image_url}" class="w-10 h-10 rounded-xl object-cover border border-slate-200 shadow-sm mx-auto cursor-pointer hover:scale-110 transition" onclick="editProduct(${p.id})" title="Ver / Cambiar foto" onerror="this.parentElement.innerHTML='<div class=\\'w-10 h-10 rounded-xl bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center text-slate-400 mx-auto text-xs\\'>📷</div>'">
                    ` : `
                        <div class="w-10 h-10 rounded-xl bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center text-slate-400 mx-auto cursor-pointer hover:bg-slate-200 transition" onclick="editProduct(${p.id})" title="Clic para agregar foto">
                            <i data-lucide="camera" class="w-4 h-4 text-slate-400 stroke-1"></i>
                        </div>
                    `}
                </td>
                <td class="p-3 font-mono font-bold text-slate-700">${p.code || '-'}</td>
                <td class="p-3 font-bold text-slate-800">${p.name}</td>
                <td class="p-3">
                    <span class="px-2 py-0.5 rounded-md text-[11px] font-semibold" style="background-color: ${p.category_color || '#e2e8f0'}20; color: ${p.category_color || '#475569'}">
                        ${p.category_name || 'Sin Categoría'}
                    </span>
                </td>
                <td class="p-3 text-right font-mono text-slate-500">${State.currentUser?.role === 'admin' ? formatMoney(p.cost_price) : '***'}</td>
                <td class="p-3 text-right font-mono font-black text-slate-900">${formatMoney(p.sale_price)}</td>
                <td class="p-3 text-center">
                    <span class="px-2 py-0.5 rounded-full font-bold ${
                        isLowStock ? 'bg-rose-100 text-rose-700 font-black' : 'bg-slate-100 text-slate-700'
                    }">${p.stock}</span>
                </td>
                <td class="p-3 text-center text-slate-500">
                    ${p.control_stock === 1 ? '<i data-lucide="check" class="w-4 h-4 mx-auto text-emerald-600"></i>' : '<span class="text-slate-400">-</span>'}
                </td>
                <td class="p-3 text-center">
                    ${State.currentUser?.role === 'admin' ? `
                    <div class="flex items-center justify-center gap-1.5">
                        <button onclick="quickStockAdjust(${p.id}, 1)" title="Sumar 1 al Stock" class="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs">+</button>
                        <button onclick="quickStockAdjust(${p.id}, -1)" title="Restar 1 al Stock" class="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs">-</button>
                        <button onclick="editProduct(${p.id})" title="Editar" class="p-1 text-slate-400 hover:text-blue-600 transition">
                            <i data-lucide="pencil" class="w-4 h-4"></i>
                        </button>
                        <button onclick="deleteProductById(${p.id})" title="Eliminar Producto" class="p-1 text-slate-400 hover:text-rose-600 transition">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                    ` : `
                    <span class="text-xs text-slate-400 font-medium italic">Solo lectura</span>
                    `}
                </td>
            </tr>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

async function quickStockAdjust(prodId, delta) {
    await fetch(`/api/products/${prodId}/stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta })
    });
    await loadProducts();
    loadInventoryProducts();
}

// ==================== GESTIÓN DE FOTOS DE PRODUCTOS Y PROMOCIONES ====================
function setProductImagePreview(url) {
    const preview = document.getElementById('prod-form-image-preview');
    const placeholder = document.getElementById('prod-form-image-placeholder');
    const removeBtn = document.getElementById('btn-remove-prod-image');
    const urlHidden = document.getElementById('prod-form-image-url');
    const urlInput = document.getElementById('prod-form-image-url-input');

    if (url && url.trim()) {
        const cleanUrl = url.trim();
        if (urlHidden) urlHidden.value = cleanUrl;
        if (urlInput) urlInput.value = cleanUrl;
        if (preview) {
            preview.src = cleanUrl;
            preview.classList.remove('hidden');
        }
        if (placeholder) placeholder.classList.add('hidden');
        if (removeBtn) removeBtn.classList.remove('hidden');
    } else {
        removeProductImage();
    }
}

function removeProductImage() {
    const preview = document.getElementById('prod-form-image-preview');
    const placeholder = document.getElementById('prod-form-image-placeholder');
    const removeBtn = document.getElementById('btn-remove-prod-image');
    const urlHidden = document.getElementById('prod-form-image-url');
    const urlInput = document.getElementById('prod-form-image-url-input');
    const fileInput = document.getElementById('prod-form-image-file');

    if (urlHidden) urlHidden.value = '';
    if (urlInput) urlInput.value = '';
    if (fileInput) fileInput.value = '';
    if (preview) {
        preview.src = '';
        preview.classList.add('hidden');
    }
    if (placeholder) placeholder.classList.remove('hidden');
    if (removeBtn) removeBtn.classList.add('hidden');
}

function toggleImageUrlInput() {
    const container = document.getElementById('prod-form-url-container');
    if (!container) return;
    container.classList.toggle('hidden');
    if (!container.classList.contains('hidden')) {
        document.getElementById('prod-form-image-url-input')?.focus();
    }
}

function handleProductImageUrlInput(val) {
    if (val && val.trim()) {
        setProductImagePreview(val.trim());
    } else {
        removeProductImage();
    }
}

async function handleProductImageFileSelect(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    // Vista previa instantánea local mientras sube
    const reader = new FileReader();
    reader.onload = (e) => {
        setProductImagePreview(e.target.result);
    };
    reader.readAsDataURL(file);

    // Subir al servidor en segundo plano
    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch('/api/upload/image', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.status === 'ok' && data.url) {
            setProductImagePreview(data.url);
            showToast('✅ Foto cargada correctamente', 'success', 2500);
        } else {
            alert(data.error || 'No se pudo subir la imagen.');
            removeProductImage();
        }
    } catch (err) {
        console.error('Error subiendo imagen:', err);
        alert('Error de conexión al subir la imagen.');
    }
}

// ==================== CARGA RÁPIDA DE FOTOS Y GESTOR MASIVO ====================
let quickPhotoCurrentProd = null;
let photoManagerFilter = 'all';

function openQuickPhotoModal(prodId) {
    const prod = State.products.find(p => p.id === prodId);
    if (!prod) return;
    quickPhotoCurrentProd = prod;

    const modal = document.getElementById('modal-quick-photo');
    if (!modal) return;

    // Llenar datos del producto
    const nameEl = document.getElementById('quick-photo-prod-name');
    const priceEl = document.getElementById('quick-photo-prod-price');
    const catBadge = document.getElementById('quick-photo-category-badge');
    const idInput = document.getElementById('quick-photo-prod-id');
    const urlInput = document.getElementById('quick-photo-current-url');
    const urlDirect = document.getElementById('quick-photo-url-input');
    const urlContainer = document.getElementById('quick-photo-url-container');

    if (nameEl) nameEl.textContent = prod.name;
    if (priceEl) priceEl.textContent = formatMoney(prod.sale_price);
    if (idInput) idInput.value = prod.id;
    if (urlDirect) urlDirect.value = '';
    if (urlContainer) urlContainer.classList.add('hidden');

    const isPromo = prod.category_id === 9 || 
                    (prod.category_name && prod.category_name.toLowerCase().includes('promo')) || 
                    prod.name.toLowerCase().includes('promo') || 
                    prod.name.toLowerCase().includes('combo');

    if (catBadge) {
        if (isPromo) {
            catBadge.textContent = '⭐ Promoción / Combo';
            catBadge.className = 'text-[10px] bg-gradient-to-r from-amber-500 to-rose-500 text-white font-black px-2 py-0.5 rounded-full shadow-xs uppercase';
        } else {
            catBadge.textContent = prod.category_name || 'Producto';
            catBadge.className = 'text-[10px] bg-slate-100 text-slate-700 font-bold px-1.5 py-0.5 rounded';
        }
    }

    // Previsualización de imagen actual
    if (prod.image_url && prod.image_url.trim()) {
        setQuickPhotoPreview(prod.image_url);
    } else {
        clearQuickPhotoSelection();
    }

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}

function closeQuickPhotoModal() {
    const modal = document.getElementById('modal-quick-photo');
    if (modal) modal.classList.add('hidden');
    quickPhotoCurrentProd = null;
    const fileInput = document.getElementById('quick-photo-file-input');
    if (fileInput) fileInput.value = '';
}

function setQuickPhotoPreview(url) {
    const previewImg = document.getElementById('quick-photo-preview-img');
    const placeholder = document.getElementById('quick-photo-preview-placeholder');
    const removeBtn = document.getElementById('btn-quick-photo-remove');
    const urlInput = document.getElementById('quick-photo-current-url');

    if (previewImg) {
        previewImg.src = url;
        previewImg.classList.remove('hidden');
    }
    if (placeholder) placeholder.classList.add('hidden');
    if (removeBtn) removeBtn.classList.remove('hidden');
    if (urlInput) urlInput.value = url;
}

function clearQuickPhotoSelection() {
    const previewImg = document.getElementById('quick-photo-preview-img');
    const placeholder = document.getElementById('quick-photo-preview-placeholder');
    const removeBtn = document.getElementById('btn-quick-photo-remove');
    const urlInput = document.getElementById('quick-photo-current-url');
    const fileInput = document.getElementById('quick-photo-file-input');
    const urlDirect = document.getElementById('quick-photo-url-input');

    if (previewImg) {
        previewImg.src = '';
        previewImg.classList.add('hidden');
    }
    if (placeholder) placeholder.classList.remove('hidden');
    if (removeBtn) removeBtn.classList.add('hidden');
    if (urlInput) urlInput.value = '';
    if (fileInput) fileInput.value = '';
    if (urlDirect) urlDirect.value = '';
}

function toggleQuickPhotoUrlInput() {
    const container = document.getElementById('quick-photo-url-container');
    if (container) {
        container.classList.toggle('hidden');
        if (!container.classList.contains('hidden')) {
            document.getElementById('quick-photo-url-input')?.focus();
        }
    }
}

function handleQuickPhotoUrlInput(url) {
    const cleanUrl = url ? url.trim() : '';
    if (cleanUrl && (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://') || cleanUrl.startsWith('/static/'))) {
        setQuickPhotoPreview(cleanUrl);
    } else if (!cleanUrl) {
        clearQuickPhotoSelection();
    }
}

async function handleQuickPhotoFileSelect(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    // Vista previa instantánea local
    const reader = new FileReader();
    reader.onload = (e) => {
        setQuickPhotoPreview(e.target.result);
    };
    reader.readAsDataURL(file);

    // Subir archivo al servidor directamente con el ID del producto
    const prodId = document.getElementById('quick-photo-prod-id')?.value;
    const formData = new FormData();
    formData.append('file', file);

    try {
        const uploadUrl = prodId ? `/api/products/${prodId}/photo` : '/api/upload/image';
        const res = await fetch(uploadUrl, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.status === 'ok') {
            const finalUrl = data.image_url || data.url;
            setQuickPhotoPreview(finalUrl);
            
            // Actualizar localmente si ya se guardó en backend
            if (prodId && data.image_url) {
                const prod = State.products.find(p => p.id === parseInt(prodId));
                if (prod) prod.image_url = data.image_url;
                renderPosProducts();
                if (document.getElementById('inventory-table-body')) {
                    loadInventoryProducts();
                }
                if (document.getElementById('modal-photo-manager') && !document.getElementById('modal-photo-manager').classList.contains('hidden')) {
                    renderPhotoManagerList();
                }
            }
            showToast('✅ Foto subida y vinculada correctamente', 'success', 2500);
        } else {
            alert(data.error || 'Error subiendo la foto');
            clearQuickPhotoSelection();
        }
    } catch (err) {
        console.error('Error subiendo foto:', err);
        alert('Error de conexión al subir la imagen.');
    }
}

async function saveQuickPhoto() {
    const prodId = document.getElementById('quick-photo-prod-id')?.value;
    const imageUrl = (document.getElementById('quick-photo-current-url')?.value || '').trim();

    if (!prodId) {
        alert('Error: No se identificó el producto.');
        return;
    }

    const saveBtn = document.getElementById('btn-save-quick-photo');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Guardando...';
    }

    try {
        const res = await fetch(`/api/products/${prodId}/photo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_url: imageUrl })
        });
        const data = await res.json();
        if (data.status === 'ok') {
            const prod = State.products.find(p => p.id === parseInt(prodId));
            if (prod) prod.image_url = imageUrl;

            closeQuickPhotoModal();
            renderPosProducts();
            if (document.getElementById('inventory-table-body')) {
                loadInventoryProducts();
            }
            if (document.getElementById('modal-photo-manager') && !document.getElementById('modal-photo-manager').classList.contains('hidden')) {
                renderPhotoManagerList();
            }
            showToast(`✅ Foto guardada para ${prod ? prod.name : 'el producto'}`, 'success', 3000);
        } else {
            alert(data.error || 'No se pudo guardar la foto');
        }
    } catch (err) {
        console.error('Error guardando foto:', err);
        alert('Error de conexión al guardar la foto.');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i data-lucide="check" class="w-4 h-4"></i><span>Guardar Foto</span>';
            if (window.lucide) lucide.createIcons();
        }
    }
}

// ==================== GESTOR MASIVO DE FOTOS ====================
function openPhotoManagerModal() {
    const modal = document.getElementById('modal-photo-manager');
    if (!modal) return;
    modal.classList.remove('hidden');
    filterPhotoManager('all');
    if (window.lucide) lucide.createIcons();
}

function closePhotoManagerModal() {
    const modal = document.getElementById('modal-photo-manager');
    if (modal) modal.classList.add('hidden');
}

function filterPhotoManager(type) {
    photoManagerFilter = type;
    const filterBtns = ['all', 'no_photo', 'with_photo', 'promos'];
    filterBtns.forEach(b => {
        const el = document.getElementById(`btn-pm-filter-${b}`);
        if (el) {
            if (b === type) {
                el.className = 'px-3 py-1.5 rounded-xl text-xs font-bold transition bg-slate-900 text-white shadow-sm';
            } else {
                el.className = 'px-3 py-1.5 rounded-xl text-xs font-bold transition bg-slate-100 hover:bg-slate-200 text-slate-700';
            }
        }
    });
    renderPhotoManagerList();
}

function renderPhotoManagerList() {
    const container = document.getElementById('photo-manager-list');
    if (!container) return;

    const searchVal = (document.getElementById('pm-search-input')?.value || '').trim().toLowerCase();

    let list = State.products;
    if (photoManagerFilter === 'no_photo') {
        list = list.filter(p => !p.image_url || !p.image_url.trim());
    } else if (photoManagerFilter === 'with_photo') {
        list = list.filter(p => p.image_url && p.image_url.trim());
    } else if (photoManagerFilter === 'promos') {
        list = list.filter(p => p.category_id === 9 || 
                               (p.category_name && p.category_name.toLowerCase().includes('promo')) || 
                               p.name.toLowerCase().includes('promo') || 
                               p.name.toLowerCase().includes('combo'));
    }

    if (searchVal) {
        list = list.filter(p => p.name.toLowerCase().includes(searchVal) || (p.code && p.code.toLowerCase().includes(searchVal)));
    }

    if (list.length === 0) {
        container.innerHTML = `
            <div class="py-12 text-center text-slate-400">
                <i data-lucide="image-off" class="w-10 h-10 mx-auto stroke-1 mb-2 text-slate-300"></i>
                <p class="text-sm font-semibold text-slate-500">No hay productos en este filtro</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    container.innerHTML = list.map(p => {
        const hasPhoto = p.image_url && p.image_url.trim();
        const isPromo = p.category_id === 9 || 
                        (p.category_name && p.category_name.toLowerCase().includes('promo')) || 
                        p.name.toLowerCase().includes('promo') || 
                        p.name.toLowerCase().includes('combo');

        return `
            <div class="pt-2.5 pb-2.5 flex items-center justify-between gap-3 hover:bg-slate-50/80 p-2 rounded-2xl transition">
                <div class="flex items-center gap-3 min-w-0">
                    <div class="w-14 h-14 rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 flex-shrink-0 flex items-center justify-center shadow-xs">
                        ${hasPhoto ? `
                            <img src="${p.image_url}" alt="${p.name}" class="w-full h-full object-cover">
                        ` : `
                            <div class="flex flex-col items-center justify-center text-slate-300">
                                <i data-lucide="camera" class="w-6 h-6 stroke-1"></i>
                            </div>
                        `}
                    </div>
                    <div class="min-w-0">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <h4 class="font-bold text-slate-800 text-sm truncate">${p.name}</h4>
                            ${isPromo ? `
                                <span class="text-[9px] bg-gradient-to-r from-amber-500 to-rose-500 text-white font-black px-2 py-0.2 rounded-full uppercase">⭐ PROMO</span>
                            ` : ''}
                        </div>
                        <div class="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                            <span class="font-mono font-bold text-blue-600">${formatMoney(p.sale_price)}</span>
                            <span>•</span>
                            <span class="text-slate-400">${p.category_name || 'General'}</span>
                        </div>
                    </div>
                </div>
                <button type="button" onclick="openQuickPhotoModal(${p.id})" class="px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 flex-shrink-0 shadow-sm ${
                    hasPhoto 
                        ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' 
                        : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20'
                }">
                    <i data-lucide="camera" class="w-3.5 h-3.5"></i>
                    <span>${hasPhoto ? 'Cambiar' : 'Cargar'}</span>
                </button>
            </div>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

function openProductModal(prod = null) {
    const modal = document.getElementById('modal-product');
    const title = document.getElementById('product-modal-title');
    const catSelect = document.getElementById('prod-form-category');
    const deleteBtn = document.getElementById('btn-delete-product-modal');

    // Llenar categorías
    if (catSelect) {
        catSelect.innerHTML = State.categories.map(c => `
            <option value="${c.id}">${c.name}</option>
        `).join('');
    }

    if (prod) {
        title.textContent = 'Editar Producto o Promoción';
        document.getElementById('prod-form-id').value = prod.id;
        document.getElementById('prod-form-name').value = prod.name;
        document.getElementById('prod-form-code').value = prod.code || '';
        document.getElementById('prod-form-category').value = prod.category_id || '';
        document.getElementById('prod-form-cost').value = prod.cost_price || 0;
        document.getElementById('prod-form-price').value = prod.sale_price || 0;
        document.getElementById('prod-form-stock').value = prod.stock || 0;
        document.getElementById('prod-form-min-stock').value = prod.min_stock || 5;
        document.getElementById('prod-form-control-stock').checked = prod.control_stock === 1;
        
        // Cargar foto si existe
        if (prod.image_url && prod.image_url.trim()) {
            setProductImagePreview(prod.image_url);
        } else {
            removeProductImage();
        }

        if (deleteBtn && State.currentUser?.role === 'admin') {
            deleteBtn.classList.remove('hidden');
        }
    } else {
        title.textContent = 'Nuevo Producto o Promoción';
        document.getElementById('product-form').reset();
        document.getElementById('prod-form-id').value = '';
        removeProductImage();
        if (deleteBtn) deleteBtn.classList.add('hidden');
    }

    // Ocultar input URL por defecto
    const urlContainer = document.getElementById('prod-form-url-container');
    if (urlContainer) urlContainer.classList.add('hidden');

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}

function closeProductModal() {
    document.getElementById('modal-product').classList.add('hidden');
}

function editProduct(prodId) {
    const prod = State.products.find(p => p.id === prodId);
    if (prod) openProductModal(prod);
}

async function deleteProductById(prodId) {
    if (State.currentUser?.role !== 'admin') {
        alert('Solo el Dueño / Administrador tiene permiso para eliminar productos.');
        return;
    }
    const prod = State.products.find(p => p.id === prodId);
    const prodName = prod ? prod.name : `ID #${prodId}`;

    if (!confirm(`¿Está seguro de que desea eliminar el producto "${prodName}"?\n\nEsta acción lo quitará permanentemente del inventario y del catálogo de ventas.`)) {
        return;
    }

    try {
        const res = await fetch(`/api/products/${prodId}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.status === 'ok') {
            await loadProducts();
            loadInventoryProducts();
            closeProductModal();
        } else {
            alert(data.error || 'Error al eliminar producto');
        }
    } catch (e) {
        console.error('Error al eliminar producto:', e);
        alert('Error al conectar con el servidor.');
    }
}

function deleteCurrentProductFromModal() {
    const id = document.getElementById('prod-form-id')?.value;
    if (id) {
        deleteProductById(parseInt(id));
    }
}

async function saveProduct(e) {
    e.preventDefault();
    const id = document.getElementById('prod-form-id')?.value;
    const payload = {
        name: document.getElementById('prod-form-name')?.value.trim(),
        code: document.getElementById('prod-form-code')?.value.trim(),
        category_id: document.getElementById('prod-form-category')?.value,
        cost_price: parseFloat(document.getElementById('prod-form-cost')?.value || 0),
        sale_price: parseFloat(document.getElementById('prod-form-price')?.value || 0),
        stock: parseFloat(document.getElementById('prod-form-stock')?.value || 0),
        min_stock: parseFloat(document.getElementById('prod-form-min-stock')?.value || 5),
        control_stock: document.getElementById('prod-form-control-stock')?.checked,
        image_url: document.getElementById('prod-form-image-url')?.value.trim() || ''
    };

    let url = '/api/products';
    let method = 'POST';
    if (id) {
        url = `/api/products/${id}`;
        method = 'PUT';
    }

    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.status === 'ok') {
            closeProductModal();
            await loadProducts();
            loadInventoryProducts();
            showToast('✅ Producto guardado con éxito', 'success', 2500);
        } else {
            alert(data.error || 'Error al guardar');
        }
    } catch (e) {
        console.error('Error guardando producto:', e);
    }
}

// ==================== CLIENTES & CTAS CTES ====================
async function loadCustomers() {
    const q = document.getElementById('cust-search-input')?.value || '';
    const res = await fetch(`/api/customers?q=${encodeURIComponent(q)}`);
    const customers = await res.json();
    renderCustomersTable(customers);
}

function renderCustomersTable(customers) {
    const tbody = document.getElementById('customers-tbody');
    if (!tbody) return;

    if (customers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400">Sin clientes registrados</td></tr>`;
        return;
    }

    tbody.innerHTML = customers.map(c => `
        <tr class="hover:bg-slate-50 transition">
            <td class="p-3 font-bold text-slate-800">${c.name}</td>
            <td class="p-3 text-slate-600">${c.phone || '-'}</td>
            <td class="p-3 text-slate-500">${c.address || '-'}</td>
            <td class="p-3 text-right font-mono text-slate-500">${formatMoney(c.credit_limit)}</td>
            <td class="p-3 text-right font-mono font-black ${c.balance > 0 ? 'text-rose-600' : 'text-slate-700'}">
                ${formatMoney(c.balance)}
            </td>
            <td class="p-3 text-center">
                <div class="flex items-center justify-center gap-2">
                    ${c.balance > 0 ? `
                        <button onclick="openCustomerPayment(${c.id}, ${c.balance})" class="px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-xs font-bold transition">
                            Abonar Deuda
                        </button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `).join('');

    if (window.lucide) lucide.createIcons();
}

function openNewCustomerModal() {
    document.getElementById('modal-customer').classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}
function closeCustomerModal() {
    document.getElementById('modal-customer').classList.add('hidden');
}

async function saveCustomer(e) {
    e.preventDefault();
    const payload = {
        name: document.getElementById('cust-form-name')?.value.trim(),
        phone: document.getElementById('cust-form-phone')?.value.trim(),
        email: document.getElementById('cust-form-email')?.value.trim(),
        address: document.getElementById('cust-form-address')?.value.trim(),
        credit_limit: parseFloat(document.getElementById('cust-form-credit')?.value || 0)
    };

    const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const d = await res.json();
    if (d.status === 'ok') {
        closeCustomerModal();
        loadCustomers();
    } else {
        alert(d.error);
    }
}

async function openCustomerPayment(custId, balance) {
    const amt = prompt(`Saldo adeudado: ${formatMoney(balance)}\nIngrese monto a abonar ($):`, balance);
    if (!amt) return;

    const res = await fetch(`/api/customers/${custId}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: parseFloat(amt) || 0 })
    });
    const d = await res.json();
    if (d.status === 'ok') {
        alert(d.message);
        loadCustomers();
        checkCurrentShift();
    } else {
        alert(d.error);
    }
}

// ==================== REPORTES & ESTADÍSTICAS ====================
async function loadReportsData() {
    try {
        const res = await fetch('/api/reports/dashboard');
        const data = await res.json();

        // Actualizar KPIs
        const todaySales = document.getElementById('rep-today-sales');
        const ticketCount = document.getElementById('rep-ticket-count');
        const avgTicket = document.getElementById('rep-avg-ticket');
        const lowStock = document.getElementById('rep-low-stock-count');

        if (todaySales) todaySales.textContent = formatMoney(data.today.today_sales);
        if (ticketCount) ticketCount.textContent = data.today.ticket_count || 0;
        if (avgTicket) avgTicket.textContent = formatMoney(data.today.avg_ticket);
        if (lowStock) lowStock.textContent = data.low_stock_alerts?.length || 0;

        // Gráfico de Ventas 7 Días
        renderDailySalesChart(data.daily_sales || []);

        // Gráfico de Medios de Pago
        renderPaymentMethodsChart(data.payment_stats || []);

        // Ranking Top 10
        renderTopProductsTable(data.top_products || []);

        // Historial de Ventas
        loadSalesHistory();

        // Monitoreo en vivo de empleados (solo Dueño)
        if (State.currentUser?.role === 'admin') {
            loadLiveMonitoringData();
        }
    } catch (e) {
        console.error('Error cargando reportes:', e);
    }
}

function renderDailySalesChart(dailySales) {
    const ctx = document.getElementById('chart-sales-days')?.getContext('2d');
    if (!ctx) return;

    if (State.salesChart) State.salesChart.destroy();

    const labels = dailySales.map(d => d.sale_date);
    const values = dailySales.map(d => d.total_amount);

    State.salesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels.length > 0 ? labels : ['Hoy'],
            datasets: [{
                label: 'Facturación ($)',
                data: values.length > 0 ? values : [0],
                backgroundColor: '#3b82f6',
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#f1f5f9' } },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderPaymentMethodsChart(stats) {
    const ctx = document.getElementById('chart-payment-methods')?.getContext('2d');
    if (!ctx) return;

    if (State.paymentsChart) State.paymentsChart.destroy();

    const labelsMap = {
        'cash': 'Efectivo',
        'card_debit': 'Débito',
        'card_credit': 'Crédito',
        'transfer': 'QR / Transf.',
        'credit': 'Cta. Cte.'
    };

    const labels = stats.map(s => labelsMap[s.method] || s.method);
    const dataVals = stats.map(s => s.amount);

    State.paymentsChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels.length > 0 ? labels : ['Sin datos'],
            datasets: [{
                data: dataVals.length > 0 ? dataVals : [1],
                backgroundColor: ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }
            }
        }
    });
}

function renderTopProductsTable(top) {
    const tbody = document.getElementById('rep-top-products-tbody');
    if (!tbody) return;

    tbody.innerHTML = top.map((p, idx) => `
        <tr class="hover:bg-slate-50">
            <td class="p-2.5 font-bold text-slate-400">#${idx + 1}</td>
            <td class="p-2.5 font-bold text-slate-800">${p.product_name}</td>
            <td class="p-2.5 text-center font-semibold text-blue-600">${p.total_qty} u.</td>
            <td class="p-2.5 text-right font-mono font-black text-slate-900">${formatMoney(p.total_revenue)}</td>
        </tr>
    `).join('');
}
let activeSalesDateFilter = null;
let currentSalesHistoryCache = [];
let selectedSalesIds = new Set();

function updateBulkActionsBar() {
    const isAdmin = State.currentUser && State.currentUser.role === 'admin';
    const bar = document.getElementById('rep-bulk-actions-bar');
    const thSelectAll = document.getElementById('rep-th-select-all');
    const selectAllChk = document.getElementById('rep-select-all-checkbox');

    if (!isAdmin) {
        selectedSalesIds.clear();
        if (bar) bar.classList.add('hidden');
        if (thSelectAll) thSelectAll.classList.add('hidden');
        if (selectAllChk) selectAllChk.classList.add('hidden');
        return;
    }

    if (thSelectAll) thSelectAll.classList.remove('hidden');
    if (selectAllChk) selectAllChk.classList.remove('hidden');

    const count = selectedSalesIds.size;
    const countSpan = document.getElementById('rep-selected-count');

    if (countSpan) countSpan.textContent = count;
    if (bar) {
        if (count > 0) {
            bar.classList.remove('hidden');
        } else {
            bar.classList.add('hidden');
        }
    }

    if (selectAllChk) {
        const total = currentSalesHistoryCache.length;
        selectAllChk.checked = total > 0 && count === total;
        selectAllChk.indeterminate = count > 0 && count < total;
    }
}

function toggleSelectSale(saleId, isChecked) {
    if (!State.currentUser || State.currentUser.role !== 'admin') {
        selectedSalesIds.clear();
        updateBulkActionsBar();
        return;
    }
    saleId = parseInt(saleId);
    if (isChecked) {
        selectedSalesIds.add(saleId);
    } else {
        selectedSalesIds.delete(saleId);
    }
    const row = document.getElementById(`rep-sale-row-${saleId}`);
    if (row) {
        if (isChecked) {
            row.classList.add('bg-rose-50/70');
            row.classList.remove('hover:bg-slate-50');
        } else {
            row.classList.remove('bg-rose-50/70');
            row.classList.add('hover:bg-slate-50');
        }
    }
    updateBulkActionsBar();
}

function toggleSelectAllSales(isChecked) {
    if (!State.currentUser || State.currentUser.role !== 'admin') {
        selectedSalesIds.clear();
        updateBulkActionsBar();
        return;
    }
    if (isChecked) {
        currentSalesHistoryCache.forEach(s => selectedSalesIds.add(s.id));
    } else {
        selectedSalesIds.clear();
    }

    document.querySelectorAll('.rep-sale-chk').forEach(chk => {
        chk.checked = isChecked;
        const row = document.getElementById(`rep-sale-row-${chk.value}`);
        if (row) {
            if (isChecked) {
                row.classList.add('bg-rose-50/70');
                row.classList.remove('hover:bg-slate-50');
            } else {
                row.classList.remove('bg-rose-50/70');
                row.classList.add('hover:bg-slate-50');
            }
        }
    });

    updateBulkActionsBar();
}

function deselectAllSales() {
    selectedSalesIds.clear();
    const selectAllChk = document.getElementById('rep-select-all-checkbox');
    if (selectAllChk) {
        selectAllChk.checked = false;
        selectAllChk.indeterminate = false;
    }
    document.querySelectorAll('.rep-sale-chk').forEach(chk => {
        chk.checked = false;
        const row = document.getElementById(`rep-sale-row-${chk.value}`);
        if (row) {
            row.classList.remove('bg-rose-50/70');
            row.classList.add('hover:bg-slate-50');
        }
    });
    updateBulkActionsBar();
}

async function bulkDeleteSelectedSales() {
    if (!State.currentUser || State.currentUser.role !== 'admin') {
        alert('Acceso restringido: Los empleados (Romina, Brisa) no tienen permiso para eliminar reportes de venta. Esta operación es de uso exclusivo del Dueño.');
        return;
    }

    const count = selectedSalesIds.size;
    if (count === 0) {
        alert('Seleccione al menos un ticket para eliminar.');
        return;
    }

    if (!confirm(`¿Está seguro de eliminar de una vez los ${count} tickets seleccionados?\n\nEsta acción borrará todas las ventas marcadas del historial y de los reportes.`)) {
        return;
    }

    const restoreStock = confirm(`¿Desea reponer al inventario el stock de los productos vendidos en estos ${count} tickets?\n\n• Aceptar: Reponer cantidades al inventario\n• Cancelar: Mantener el stock tal como está`);

    try {
        const payload = {
            order_ids: Array.from(selectedSalesIds),
            restore_stock: restoreStock
        };

        const res = await fetch('/api/reports/sales/bulk_delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.status === 'ok') {
            selectedSalesIds.clear();
            updateBulkActionsBar();
            await loadSalesHistory(activeSalesDateFilter);
            await loadReportsData();
            alert(data.message || `Se eliminaron ${count} tickets exitosamente`);
        } else {
            alert(data.error || 'Error al eliminar los tickets seleccionados');
        }
    } catch (err) {
        console.error('Error eliminando tickets masivamente:', err);
        alert('Error de conexión al eliminar los tickets.');
    }
}

async function loadSalesHistory(dateFilter = null) {
    try {
        if (dateFilter !== undefined && dateFilter !== null) {
            activeSalesDateFilter = dateFilter;
        } else if (dateFilter === '') {
            activeSalesDateFilter = null;
        }

        let url = '/api/reports/sales?limit=50';
        if (activeSalesDateFilter) {
            url += `&date=${encodeURIComponent(activeSalesDateFilter)}`;
        }

        const res = await fetch(url);
        const sales = await res.json();
        currentSalesHistoryCache = Array.isArray(sales) ? sales : [];
        const tbody = document.getElementById('rep-sales-tbody');
        if (!tbody) return;

        const isAdmin = State.currentUser && State.currentUser.role === 'admin';
        const thSelectAll = document.getElementById('rep-th-select-all');
        if (thSelectAll) {
            if (isAdmin) {
                thSelectAll.classList.remove('hidden');
            } else {
                thSelectAll.classList.add('hidden');
            }
        }

        // Mantener seleccionados solo los que aún existan (solo si es admin)
        if (!isAdmin) {
            selectedSalesIds.clear();
        } else {
            const currentIds = new Set(currentSalesHistoryCache.map(s => s.id));
            for (const sid of selectedSalesIds) {
                if (!currentIds.has(sid)) selectedSalesIds.delete(sid);
            }
        }

        if (currentSalesHistoryCache.length === 0) {
            const colSpan = isAdmin ? 8 : 7;
            tbody.innerHTML = `<tr><td colspan="${colSpan}" class="p-6 text-center text-slate-400">No se encontraron ventas registradas${activeSalesDateFilter ? ' para la fecha ' + activeSalesDateFilter : ''}.</td></tr>`;
            updateBulkActionsBar();
            return;
        }

        const methodMap = {
            'cash': 'Efectivo',
            'card_debit': 'Débito',
            'card_credit': 'Crédito',
            'transfer': 'Transferencia / QR',
            'credit': 'Cta. Cte.'
        };

        tbody.innerHTML = currentSalesHistoryCache.map(s => {
            const rawDt = s.created_at ? s.created_at.substring(0, 19) : '-';
            const isChecked = selectedSalesIds.has(s.id);
            const rowClass = isChecked ? 'bg-rose-50/70' : 'hover:bg-slate-50';

            return `
            <tr id="rep-sale-row-${s.id}" class="${rowClass} transition">
                ${isAdmin ? `
                <td class="p-2.5 w-10 text-center">
                    <input type="checkbox" value="${s.id}" ${isChecked ? 'checked' : ''} onchange="toggleSelectSale(${s.id}, this.checked)" class="rep-sale-chk w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer">
                </td>` : ''}
                <td class="p-2.5 font-mono font-bold text-slate-800">#${s.id}</td>
                <td class="p-2.5 text-slate-600 font-mono text-[11px]">${rawDt}</td>
                <td class="p-2.5 uppercase text-[10px] font-bold tracking-wider text-slate-500">${s.order_type}</td>
                <td class="p-2.5 font-medium text-slate-700">${s.table_name || s.customer_name || 'Mostrador'}</td>
                <td class="p-2.5 text-slate-600">${methodMap[s.payment_method] || s.payment_method}</td>
                <td class="p-2.5 text-right font-mono font-black text-slate-900">${formatMoney(s.total)}</td>
                <td class="p-2.5 text-center">
                    <div class="flex items-center justify-center gap-1.5">
                        <button onclick='showThermalTicket(${JSON.stringify(s)})' class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold" title="Reimprimir Ticket">
                            Reimprimir
                        </button>
                        ${isAdmin ? `
                        <button onclick="openEditSaleModal(${s.id})" class="p-1 text-slate-400 hover:text-blue-600 rounded transition" title="Modificar Ticket (Fecha, Hora, Año, Importe, Pago)">
                            <i data-lucide="pencil" class="w-4 h-4"></i>
                        </button>
                        <button onclick="deleteSaleOrder(${s.id})" class="p-1 text-slate-400 hover:text-rose-600 rounded transition" title="Eliminar Ticket">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
        }).join('');

        updateBulkActionsBar();
        if (window.lucide) lucide.createIcons();
    } catch (e) {
        console.error('Error cargando historial de ventas:', e);
    }
}

function filterSalesByDate(dateVal) {
    loadSalesHistory(dateVal || '');
}

function clearSalesDateFilter() {
    const inp = document.getElementById('rep-sales-date-filter');
    if (inp) inp.value = '';
    loadSalesHistory('');
}

function openEditSaleModal(saleId) {
    if (!State.currentUser || State.currentUser.role !== 'admin') {
        alert('Acceso restringido: Solo el Dueño puede modificar ventas.');
        return;
    }
    const sale = currentSalesHistoryCache.find(s => s.id === saleId);
    if (!sale) return;

    document.getElementById('edit-sale-id').value = sale.id;
    document.getElementById('edit-sale-title').textContent = `Modificar Ticket #${sale.id}`;
    
    if (sale.created_at) {
        const dtStr = sale.created_at.substring(0, 16).replace(' ', 'T');
        document.getElementById('edit-sale-datetime').value = dtStr;
    }
    document.getElementById('edit-sale-total').value = sale.total;
    document.getElementById('edit-sale-method').value = sale.payment_method || 'cash';
    document.getElementById('edit-sale-customer').value = sale.customer_name || sale.table_name || '';
    document.getElementById('edit-sale-notes').value = sale.notes || '';

    const modal = document.getElementById('modal-edit-sale');
    if (modal) modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}

function closeEditSaleModal() {
    const modal = document.getElementById('modal-edit-sale');
    if (modal) modal.classList.add('hidden');
}

async function saveEditSale(e) {
    e.preventDefault();
    if (!State.currentUser || State.currentUser.role !== 'admin') {
        alert('Acceso restringido: Solo el Dueño puede guardar modificaciones en ventas.');
        return;
    }
    const id = document.getElementById('edit-sale-id')?.value;
    if (!id) return;

    const payload = {
        created_at: document.getElementById('edit-sale-datetime')?.value,
        total: parseFloat(document.getElementById('edit-sale-total')?.value || 0),
        payment_method: document.getElementById('edit-sale-method')?.value,
        customer_name: document.getElementById('edit-sale-customer')?.value.trim(),
        notes: document.getElementById('edit-sale-notes')?.value.trim()
    };

    try {
        const res = await fetch(`/api/reports/sales/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.status === 'ok') {
            closeEditSaleModal();
            await loadSalesHistory();
            await loadReports();
            alert(data.message || 'Ticket actualizado exitosamente');
        } else {
            alert(data.error || 'Error al actualizar venta');
        }
    } catch (err) {
        console.error('Error guardando edición de venta:', err);
        alert('Error de conexión al actualizar la venta.');
    }
}

async function deleteSaleOrder(saleId) {
    if (!State.currentUser || State.currentUser.role !== 'admin') {
        alert('Acceso restringido: Los empleados (Romina, Brisa) no tienen permiso para eliminar comprobantes o reportes de venta. Esta operación es de uso exclusivo del Dueño.');
        return;
    }
    if (!confirm(`¿Está seguro de eliminar el Ticket #${saleId}?\n\nEsta acción borrará la venta del historial y de los reportes.`)) {
        return;
    }

    const restoreStock = confirm('¿Desea reponer al inventario el stock de los productos que se vendieron en este ticket?\n\n• Aceptar: Reponer cantidades al inventario\n• Cancelar: Mantener el stock tal como está');

    try {
        const res = await fetch(`/api/reports/sales/${saleId}?restore_stock=${restoreStock ? 1 : 0}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.status === 'ok') {
            await loadSalesHistory();
            await loadReports();
            if (restoreStock) {
                await loadProducts();
                loadInventoryProducts();
            }
            alert(data.message || 'Venta eliminada exitosamente');
        } else {
            alert(data.error || 'Error al eliminar venta');
        }
    } catch (e) {
        console.error('Error eliminando venta:', e);
        alert('Error al conectar con el servidor.');
    }
}


// ==================== CONFIGURACIÓN ====================
function loadSettingsForm() {
    const c = State.config;
    document.getElementById('cfg-business-name').value = c.business_name || '';
    document.getElementById('cfg-business-subtitle').value = c.business_subtitle || '';
    document.getElementById('cfg-cuit').value = c.cuit || '';
    document.getElementById('cfg-phone').value = c.phone || '';
    document.getElementById('cfg-address').value = c.address || '';
    document.getElementById('cfg-currency').value = c.currency || '$';
    document.getElementById('cfg-tax-percent').value = c.tax_percent || '21';
    document.getElementById('cfg-ticket-header').value = c.ticket_header || '';
    document.getElementById('cfg-ticket-footer').value = c.ticket_footer || '';

    // Cargar empleados en la tabla de configuración si es admin
    if (State.currentUser?.role === 'admin') {
        loadSettingsEmployees();
    }
}

// Cargar y listar empleados en Configuración
async function loadSettingsEmployees() {
    const tbody = document.getElementById('cfg-employees-tbody');
    if (!tbody) return;

    try {
        const res = await fetch('/api/auth/users');
        const users = await res.json();
        State.loginUsersList = users;

        if (!users || !users.length) {
            tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">No hay empleados registrados</td></tr>`;
            return;
        }

        tbody.innerHTML = users.map(u => {
            const isAdmin = u.role === 'admin';
            const roleBadge = isAdmin
                ? `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700">Dueño / Admin</span>`
                : `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">Empleado</span>`;

            return `
                <tr class="hover:bg-slate-50/80 transition">
                    <td class="p-2.5 font-bold text-slate-800 flex items-center gap-2">
                        <div class="w-7 h-7 rounded-xl ${isAdmin ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'} flex items-center justify-center font-bold text-xs">
                            ${u.name.charAt(0).toUpperCase()}
                        </div>
                        <span>${u.name}</span>
                    </td>
                    <td class="p-2.5 font-mono text-slate-500">${u.username}</td>
                    <td class="p-2.5">${roleBadge}</td>
                    <td class="p-2.5 text-center font-mono text-slate-400">••••</td>
                    <td class="p-2.5 text-center">
                        <div class="flex items-center justify-center gap-1.5">
                            <button type="button" onclick="openSetEmployeePinModal(${u.id}, '${u.name.replace(/'/g, "\\'")}')"
                                class="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold rounded-xl text-[11px] transition flex items-center gap-1 shadow-xs"
                                title="Asignar o Generar Nueva Clave">
                                <i data-lucide="key" class="w-3.5 h-3.5"></i>
                                <span>Clave</span>
                            </button>
                            ${!isAdmin ? `
                                <button type="button" onclick="deleteEmployee(${u.id}, '${u.name.replace(/'/g, "\\'")}')"
                                    class="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition"
                                    title="Dar de baja empleado">
                                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                                </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        if (window.lucide) lucide.createIcons();
    } catch (e) {
        console.error('Error cargando lista de empleados:', e);
        tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-rose-500">Error al cargar empleados</td></tr>`;
    }
}

// Modal Asignar / Generar Clave (Dueño)
function openSetEmployeePinModal(userId, userName) {
    const modal = document.getElementById('modal-set-employee-pin');
    if (!modal) return;

    document.getElementById('set-pin-target-user-id').value = userId;
    const title = document.getElementById('set-pin-employee-title');
    if (title) title.textContent = `Empleado: ${userName}`;

    const input = document.getElementById('set-pin-input');
    if (input) {
        input.value = '';
        input.focus();
    }

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}

function closeSetEmployeePinModal() {
    const modal = document.getElementById('modal-set-employee-pin');
    if (modal) modal.classList.add('hidden');
}

function generateRandomPinForInput() {
    // Generar PIN numérico aleatorio de 4 dígitos
    const randomPin = Math.floor(1000 + Math.random() * 9000).toString();
    const input = document.getElementById('set-pin-input');
    if (input) {
        input.value = randomPin;
        input.focus();
        input.select();
    }
}

async function submitSetEmployeePin(e) {
    e.preventDefault();
    const userId = document.getElementById('set-pin-target-user-id')?.value;
    const pin = document.getElementById('set-pin-input')?.value.trim();

    if (!userId || !pin) {
        alert('Por favor ingrese la clave o PIN');
        return;
    }

    if (pin.length < 4) {
        alert('La clave o PIN debe tener al menos 4 dígitos');
        return;
    }

    try {
        const res = await fetch(`/api/auth/users/${userId}/set_pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: pin })
        });
        const data = await res.json();
        if (data.status === 'ok') {
            alert(`✅ ¡Clave asignada exitosamente!\n\nNueva Clave / PIN: ${pin}\n\nPor favor comunícasela al empleado.`);
            closeSetEmployeePinModal();
            await loadSettingsEmployees();
            await fetchAuthUsers();
        } else {
            alert(data.error || 'No se pudo actualizar la clave');
        }
    } catch (err) {
        console.error('Error guardando clave:', err);
        alert('Error al conectar con el servidor');
    }
}

// Modal Crear Nuevo Empleado (Dueño)
function openCreateEmployeeModal() {
    const modal = document.getElementById('modal-create-employee');
    if (!modal) return;

    document.getElementById('new-emp-name').value = '';
    document.getElementById('new-emp-username').value = '';
    document.getElementById('new-emp-pin').value = '';
    document.getElementById('new-emp-role').value = 'empleado';

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}

function closeCreateEmployeeModal() {
    const modal = document.getElementById('modal-create-employee');
    if (modal) modal.classList.add('hidden');
}

function generateRandomPinForNewEmp() {
    const randomPin = Math.floor(1000 + Math.random() * 9000).toString();
    const input = document.getElementById('new-emp-pin');
    if (input) {
        input.value = randomPin;
        input.focus();
    }
}

async function submitCreateEmployee(e) {
    e.preventDefault();
    const name = document.getElementById('new-emp-name')?.value.trim();
    const username = document.getElementById('new-emp-username')?.value.trim().toLowerCase();
    const pin = document.getElementById('new-emp-pin')?.value.trim();
    const role = document.getElementById('new-emp-role')?.value || 'empleado';

    if (!name || !username || !pin) {
        alert('Por favor complete todos los campos requeridos');
        return;
    }

    if (pin.length < 4) {
        alert('La clave o PIN debe tener al menos 4 dígitos');
        return;
    }

    try {
        const res = await fetch('/api/auth/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, username, pin, role })
        });
        const data = await res.json();
        if (data.status === 'ok') {
            alert(`✅ ¡Empleado "${name}" creado exitosamente!\n\nClave / PIN de acceso: ${pin}`);
            closeCreateEmployeeModal();
            await loadSettingsEmployees();
            await fetchAuthUsers();
        } else {
            alert(data.error || 'No se pudo crear el empleado');
        }
    } catch (err) {
        console.error('Error creando empleado:', err);
        alert('Error al conectar con el servidor');
    }
}

// Dar de baja o desactivar empleado
async function deleteEmployee(userId, userName) {
    if (!confirm(`¿Estás seguro de que deseas dar de baja al empleado "${userName}"?`)) {
        return;
    }

    try {
        const res = await fetch(`/api/auth/users/${userId}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.status === 'ok') {
            alert(`Empleado "${userName}" dado de baja correctamente.`);
            await loadSettingsEmployees();
            await fetchAuthUsers();
        } else {
            alert(data.error || 'No se pudo dar de baja al empleado');
        }
    } catch (err) {
        console.error('Error eliminando empleado:', err);
        alert('Error al conectar con el servidor');
    }
}

async function saveSystemConfig() {
    const payload = {
        business_name: document.getElementById('cfg-business-name')?.value.trim(),
        business_subtitle: document.getElementById('cfg-business-subtitle')?.value.trim(),
        cuit: document.getElementById('cfg-cuit')?.value.trim(),
        phone: document.getElementById('cfg-phone')?.value.trim(),
        address: document.getElementById('cfg-address')?.value.trim(),
        currency: document.getElementById('cfg-currency')?.value.trim() || '$',
        tax_percent: document.getElementById('cfg-tax-percent')?.value.trim() || '21',
        ticket_header: document.getElementById('cfg-ticket-header')?.value.trim(),
        ticket_footer: document.getElementById('cfg-ticket-footer')?.value.trim()
    };

    try {
        const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const d = await res.json();
        if (d.status === 'ok') {
            await loadConfig();
            alert('Configuración guardada exitosamente');
        }
    } catch (e) {
        console.error('Error guardando configuración:', e);
    }
}

// ==================== SELECTOR DE CLIENTES EN POS ====================
async function openSelectCustomerModal() {
    const res = await fetch('/api/customers');
    const customers = await res.json();

    const choice = prompt(
        'Seleccione Cliente para la comanda:\n' +
        '0 - Consumidor Final\n' +
        customers.map((c, i) => `${i + 1} - ${c.name} (Saldo: ${formatMoney(c.balance)})`).join('\n')
    );

    if (choice === null) return;
    const idx = parseInt(choice);
    if (idx === 0 || isNaN(idx)) {
        State.currentCart.customerId = null;
        State.currentCart.customerName = 'Consumidor Final';
    } else if (customers[idx - 1]) {
        const selected = customers[idx - 1];
        State.currentCart.customerId = selected.id;
        State.currentCart.customerName = selected.name;
    }

    const nameEl = document.getElementById('pos-selected-customer-name');
    if (nameEl) nameEl.textContent = State.currentCart.customerName;
}

// ==================== AGREGAR MESA NUEVA ====================
async function openNewTableModal() {
    const number = prompt('Número o nombre de la mesa (Ej: Mesa 11, Barra 4):');
    if (!number) return;
    const capacity = parseInt(prompt('Capacidad de personas:', '4') || 4);

    const res = await fetch('/api/tables');
    const sectors = await res.json();
    const sectorId = sectors[0]?.id || 1;

    await fetch('/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sector_id: sectorId,
            number: number,
            name: number,
            capacity: capacity
        })
    });
    loadTables();
}

// ==================== TRANSFERIR / MUDAR MESA ====================
async function openTransferTableModal() {
    if (!activeTableData || !activeTableData.table) return;
    const res = await fetch('/api/tables');
    const sectors = await res.json();

    let freeTables = [];
    sectors.forEach(s => {
        (s.tables || []).forEach(t => {
            if (t.status === 'free') freeTables.push(t);
        });
    });

    if (freeTables.length === 0) {
        alert('No hay mesas libres disponibles para transferir la comanda');
        return;
    }

    const choice = prompt(
        'Seleccione la mesa de destino (número en la lista):\n' +
        freeTables.map((t, i) => `${i + 1} - ${t.name || t.number} (Cap: ${t.capacity})`).join('\n')
    );

    if (!choice) return;
    const idx = parseInt(choice) - 1;
    const targetTable = freeTables[idx];
    if (!targetTable) return;

    const r = await fetch(`/api/tables/${activeTableData.table.id}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_table_id: targetTable.id })
    });
    const data = await r.json();
    if (data.status === 'ok') {
        alert('Comanda transferida exitosamente');
        closeTableOrderModal();
        loadTables();
    } else {
        alert(data.error);
    }
}

// ==================== GESTOR DE CATEGORÍAS (CREAR Y BORRAR) ====================
async function openCategoryManagerModal() {
    if (State.currentUser?.role !== 'admin') {
        alert('Acceso restringido: Solo el Dueño / Administrador puede gestionar categorías.');
        return;
    }
    await loadCategories();
    renderCategoriesModalList();
    const modal = document.getElementById('modal-categories');
    if (modal) modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}

function closeCategoryManagerModal() {
    const modal = document.getElementById('modal-categories');
    if (modal) modal.classList.add('hidden');
    const inputName = document.getElementById('new-cat-name');
    if (inputName) inputName.value = '';
}

function renderCategoriesModalList() {
    const container = document.getElementById('modal-categories-list');
    if (!container) return;

    if (!State.categories || State.categories.length === 0) {
        container.innerHTML = `
            <div class="text-center py-6 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <i data-lucide="tags" class="w-8 h-8 text-slate-300 mx-auto mb-1"></i>
                <p class="text-xs text-slate-400">No hay categorías creadas todavía</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    container.innerHTML = State.categories.map(cat => {
        const prodCount = cat.product_count !== undefined ? cat.product_count : (State.products ? State.products.filter(p => p.category_id === cat.id && p.is_active === 1).length : 0);
        return `
            <div class="flex items-center justify-between p-2.5 bg-slate-50 hover:bg-slate-100/80 rounded-2xl border border-slate-200 transition">
                <div class="flex items-center gap-2.5 min-w-0">
                    <span class="w-4 h-4 rounded-full flex-shrink-0 shadow-sm border border-white" style="background-color: ${cat.color || '#3B82F6'}"></span>
                    <div class="truncate">
                        <span class="text-xs font-bold text-slate-800 block truncate">${cat.name}</span>
                        <span class="text-[11px] text-slate-400">${prodCount} ${prodCount === 1 ? 'producto vinculado' : 'productos vinculados'}</span>
                    </div>
                </div>
                <button type="button" onclick="deleteCategory(${cat.id}, '${cat.name.replace(/'/g, "\\'")}', ${prodCount})" class="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl text-xs font-bold transition flex items-center gap-1 flex-shrink-0 active:scale-95 shadow-sm" title="Eliminar categoría">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    <span>Borrar</span>
                </button>
            </div>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

async function submitNewCategory(e) {
    e.preventDefault();
    if (State.currentUser?.role !== 'admin') {
        alert('Acceso restringido: Solo el Dueño / Administrador puede crear categorías.');
        return;
    }

    const nameInput = document.getElementById('new-cat-name');
    const colorInput = document.getElementById('new-cat-color');
    const name = nameInput?.value.trim();
    const color = colorInput?.value || '#3B82F6';

    if (!name) return;

    try {
        const res = await fetch('/api/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, color, icon: 'tag' })
        });
        const d = await res.json();
        if (d.status === 'ok') {
            if (nameInput) nameInput.value = '';
            await refreshCategoriesEverywhere();
            renderCategoriesModalList();
        } else {
            alert(d.error || 'Error al crear la categoría');
        }
    } catch (err) {
        console.error('Error creando categoría:', err);
        alert('Error de conexión al crear categoría');
    }
}

async function deleteCategory(catId, catName, prodCount) {
    if (State.currentUser?.role !== 'admin') {
        alert('Acceso restringido: Solo el Dueño / Administrador puede eliminar categorías.');
        return;
    }

    let warningMsg = `¿Estás seguro de que deseas eliminar la categoría "${catName}"?`;
    if (prodCount > 0) {
        warningMsg += `\n\n⚠️ Atención: Tiene ${prodCount} producto(s) asignado(s). Al borrarla, los productos quedarán sin categoría pero NO se eliminarán.`;
    }

    if (!confirm(warningMsg)) return;

    try {
        const res = await fetch(`/api/categories/${catId}`, {
            method: 'DELETE'
        });
        const d = await res.json();
        if (d.status === 'ok') {
            if (State.activeCategoryFilter === catId) {
                State.activeCategoryFilter = null;
            }
            await refreshCategoriesEverywhere();
            renderCategoriesModalList();
        } else {
            alert(d.error || 'Error al eliminar la categoría');
        }
    } catch (err) {
        console.error('Error eliminando categoría:', err);
        alert('Error de conexión al eliminar categoría');
    }
}

async function refreshCategoriesEverywhere() {
    await loadCategories();
    renderPosCategories();
    if (typeof renderPosProducts === 'function') renderPosProducts();

    // Actualizar selector del inventario
    const catSelect = document.getElementById('inv-category-filter');
    if (catSelect) {
        const currentVal = catSelect.value;
        catSelect.innerHTML = '<option value="">Todas las Categorías</option>';
        State.categories.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.name;
            if (String(c.id) === String(currentVal)) opt.selected = true;
            catSelect.appendChild(opt);
        });
    }

    // Actualizar selector del modal de nuevo producto si existe
    const prodCatSelect = document.getElementById('prod-category-select');
    if (prodCatSelect) {
        const currentProdVal = prodCatSelect.value;
        prodCatSelect.innerHTML = '<option value="">Sin Categoría</option>';
        State.categories.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.name;
            if (String(c.id) === String(currentProdVal)) opt.selected = true;
            prodCatSelect.appendChild(opt);
        });
    }

    if (typeof loadInventoryProducts === 'function') loadInventoryProducts();
}


// ==================== AUTENTICACIÓN Y ROLES DE USUARIO ====================

async function initAuthUser() {
    await fetchAuthUsers();

    // Comprobar si hay sesión previa guardada
    const saved = sessionStorage.getItem('posberry_auth_user');
    if (saved) {
        try {
            const user = JSON.parse(saved);
            const exists = State.loginUsersList.find(u => u.id === user.id);
            if (exists) {
                State.currentUser = exists;
                State.isAuthenticated = true;
                hideScreenLogin();
                applyUserPermissions();
                return;
            }
        } catch (e) {
            console.warn('Sesión previa inválida');
        }
    }

    // Modo Cliente / Público por defecto (NO bloquea la pantalla, abre directo al catálogo de pedidos)
    State.currentUser = null;
    State.isAuthenticated = false;
    hideScreenLogin();
    applyUserPermissions();
}

async function fetchAuthUsers() {
    try {
        const res = await fetch('/api/auth/users');
        State.loginUsersList = await res.json();
    } catch (e) {
        console.error('Error cargando usuarios:', e);
        State.loginUsersList = [
            { id: 1, name: 'Dueño / Admin', username: 'admin', role: 'admin' },
            { id: 2, name: 'Empleado Mostrador', username: 'empleado', role: 'empleado' }
        ];
    }
}

function showScreenLogin() {
    const screen = document.getElementById('screen-login');
    if (!screen) return;
    screen.classList.remove('hidden');

    const loginTitle = document.getElementById('login-screen-title');
    if (loginTitle) loginTitle.textContent = 'biencorrentino';

    // Regresar al Paso 1: Selección de Usuario
    const stepUser = document.getElementById('login-step-user');
    const stepPin = document.getElementById('login-step-pin');
    const errEl = document.getElementById('login-pin-error');
    if (stepUser) stepUser.classList.remove('hidden');
    if (stepPin) stepPin.classList.add('hidden');
    if (errEl) errEl.classList.add('hidden');

    State.enteredPin = '';
    State.selectedLoginUserId = null;
    updateLoginPinDots();

    renderLoginScreenUsers();
    if (window.lucide) lucide.createIcons();
}

function hideScreenLogin() {
    const screen = document.getElementById('screen-login');
    if (screen) screen.classList.add('hidden');
}

function renderLoginScreenUsers() {
    const grid = document.getElementById('login-users-grid');
    if (!grid) return;

    grid.innerHTML = State.loginUsersList.map(u => {
        const isAdmin = u.role === 'admin';
        return `
            <button type="button" onclick="selectLoginUserCard(${u.id})"
                class="group p-4 rounded-2xl border-2 transition-all duration-150 text-left flex flex-col justify-between h-32 active:scale-95 cursor-pointer ${
                    isAdmin
                        ? 'border-amber-500/40 bg-gradient-to-br from-amber-500/10 to-amber-950/30 hover:border-amber-400 hover:bg-amber-500/20'
                        : 'border-blue-500/40 bg-gradient-to-br from-blue-500/10 to-blue-950/30 hover:border-blue-400 hover:bg-blue-500/20'
                }">
                <div class="flex items-center justify-between">
                    <div class="w-10 h-10 rounded-xl flex items-center justify-center font-black text-lg ${
                        isAdmin ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20' : 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                    }">
                        <i data-lucide="${isAdmin ? 'crown' : 'user'}" class="w-5 h-5"></i>
                    </div>
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                        isAdmin ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30' : 'bg-blue-400/20 text-blue-300 border border-blue-400/30'
                    }">
                        ${isAdmin ? 'Dueño' : 'Empleado'}
                    </span>
                </div>
                <div>
                    <h4 class="font-bold text-base text-slate-100 group-hover:text-white">${u.name}</h4>
                    <p class="text-[11px] text-slate-400 mt-0.5">
                        ${isAdmin ? 'Acceso total y reportes' : 'Ventas y comandas'}
                    </p>
                </div>
            </button>
        `;
    }).join('');
}

function selectLoginUserCard(userId) {
    const user = State.loginUsersList.find(u => u.id === userId);
    if (!user) return;

    State.selectedLoginUserId = userId;
    State.enteredPin = '';
    updateLoginPinDots();
    document.getElementById('login-pin-error')?.classList.add('hidden');

    const nameLabel = document.getElementById('login-target-user-name');
    const roleLabel = document.getElementById('login-target-user-role');
    const avatar = document.getElementById('login-avatar-initial');

    if (nameLabel) nameLabel.textContent = user.name;
    if (roleLabel) roleLabel.textContent = user.role === 'admin' ? 'Dueño / Administrador' : 'Empleado Mostrador';
    if (avatar) avatar.textContent = user.name.charAt(0).toUpperCase();

    // Mostrar Paso 2 (PIN)
    document.getElementById('login-step-user')?.classList.add('hidden');
    document.getElementById('login-step-pin')?.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}

function switchLoginUser() {
    State.enteredPin = '';
    State.selectedLoginUserId = null;
    document.getElementById('login-step-pin')?.classList.add('hidden');
    document.getElementById('login-step-user')?.classList.remove('hidden');
    document.getElementById('login-pin-error')?.classList.add('hidden');
}

function pressLoginPin(digit) {
    if (State.enteredPin.length >= 8) return;
    State.enteredPin += digit;
    updateLoginPinDots();
    document.getElementById('login-pin-error')?.classList.add('hidden');

    if (State.enteredPin.length === 4) {
        setTimeout(submitLoginPin, 150);
    }
}

function clearLoginPin() {
    State.enteredPin = '';
    updateLoginPinDots();
    document.getElementById('login-pin-error')?.classList.add('hidden');
}

function updateLoginPinDots() {
    const dotsContainer = document.getElementById('login-pin-dots');
    if (!dotsContainer) return;
    const len = State.enteredPin.length;
    dotsContainer.innerHTML = [0, 1, 2, 3].map(i => `
        <span class="w-4 h-4 rounded-full border-2 transition-all duration-150 ${
            i < len ? 'bg-blue-500 border-blue-400 scale-110 shadow-lg shadow-blue-500/50' : 'bg-transparent border-slate-600'
        }"></span>
    `).join('');
}

async function submitLoginPin() {
    if (!State.selectedLoginUserId) {
        switchLoginUser();
        return;
    }
    if (State.enteredPin.length === 0) return;

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: State.selectedLoginUserId,
                pin: State.enteredPin
            })
        });
        const data = await res.json();
        if (data.status === 'ok') {
            State.currentUser = data.user;
            State.isAuthenticated = true;
            sessionStorage.setItem('posberry_auth_user', JSON.stringify(data.user));

            hideScreenLogin();
            applyUserPermissions();
            initStaffAudioAndNotifications();
            showToast(`¡Bienvenido/a, ${data.user.name}!`, 'success');

            // Refrescar vistas
            renderPosProducts();
            if (document.getElementById('view-inventory') && !document.getElementById('view-inventory').classList.contains('hidden')) {
                loadInventoryProducts();
            }
            if (document.getElementById('view-reports') && !document.getElementById('view-reports').classList.contains('hidden')) {
                loadReportsData();
            }
        } else {
            const errEl = document.getElementById('login-pin-error');
            if (errEl) {
                errEl.textContent = data.error || 'PIN incorrecto. Intente nuevamente.';
                errEl.classList.remove('hidden');
            }
            clearLoginPin();
        }
    } catch (e) {
        console.error('Error en login:', e);
        showToast('Error al conectar con el servidor', 'error');
    }
}

function logoutUser() {
    if (confirm('¿Desea cerrar la sesión de operador y volver al modo cliente?')) {
        sessionStorage.removeItem('posberry_auth_user');
        State.currentUser = null;
        State.isAuthenticated = false;
        hideScreenLogin();
        applyUserPermissions();
        navigateTo('pos');
        showToast('Sesión de operador cerrada. Catálogo abierto para pedidos de clientes.', 'info');
    }
}

// Escuchar teclado físico para ingresar PIN en el modal de login
window.addEventListener('keydown', (e) => {
    const screen = document.getElementById('screen-login');
    if (!screen || screen.classList.contains('hidden')) return;

    const pinStep = document.getElementById('login-step-pin');
    if (!pinStep || pinStep.classList.contains('hidden')) return;

    if (e.key >= '0' && e.key <= '9') {
        pressLoginPin(e.key);
    } else if (e.key === 'Backspace') {
        State.enteredPin = State.enteredPin.slice(0, -1);
        updateLoginPinDots();
    } else if (e.key === 'Enter') {
        submitLoginPin();
    } else if (e.key === 'Escape') {
        closeUserLoginModal();
    }
});

function applyUserPermissions() {
    const u = State.currentUser;

    const loginBtn = document.getElementById('header-login-btn');
    const loginBtnMobile = document.getElementById('header-login-btn-mobile');
    const userContainer = document.getElementById('header-user-container');
    const userMobileContainer = document.getElementById('header-user-mobile-container');
    const staffEls = document.querySelectorAll('.staff-only');
    const adminEls = document.querySelectorAll('.admin-only');

    if (!u) {
        // MODO PÚBLICO / CLIENTE DIRECTO
        if (loginBtn) loginBtn.classList.remove('hidden');
        if (loginBtnMobile) loginBtnMobile.classList.remove('hidden');
        if (userContainer) userContainer.classList.add('hidden');
        if (userMobileContainer) userMobileContainer.classList.add('hidden');

        // Ocultar módulos del personal
        staffEls.forEach(el => el.classList.add('hidden'));
        adminEls.forEach(el => el.classList.add('hidden'));

        // Redirigir siempre a la pantalla de pedido
        const currentView = document.querySelector('section:not(.hidden)')?.id;
        if (currentView && currentView !== 'view-pos') {
            navigateTo('pos');
        }
        if (window.lucide) lucide.createIcons();
        return;
    }

    // MODO OPERADOR LOGUEADO (DUEÑO O EMPLEADO)
    if (loginBtn) loginBtn.classList.add('hidden');
    if (loginBtnMobile) loginBtnMobile.classList.add('hidden');
    if (userContainer) userContainer.classList.remove('hidden');
    if (userMobileContainer) userMobileContainer.classList.remove('hidden');

    const nameEl = document.getElementById('header-user-name');
    const roleEl = document.getElementById('header-user-role');
    const mobRoleEl = document.getElementById('header-user-role-mobile');

    if (nameEl) nameEl.textContent = u.name;
    if (roleEl) {
        if (u.role === 'admin') {
            roleEl.textContent = 'Dueño';
            roleEl.className = 'text-[10px] bg-amber-500/30 text-amber-300 font-bold px-1.5 py-0.5 rounded uppercase border border-amber-400/20';
        } else {
            roleEl.textContent = 'Empleado';
            roleEl.className = 'text-[10px] bg-blue-500/30 text-blue-300 font-bold px-1.5 py-0.5 rounded uppercase border border-blue-400/20';
        }
    }
    if (mobRoleEl) {
        if (u.role === 'admin') {
            mobRoleEl.textContent = 'Dueño';
            mobRoleEl.className = 'text-[10px] bg-amber-500/30 text-amber-300 font-bold px-1.5 py-0.5 rounded uppercase border border-amber-400/20';
        } else {
            mobRoleEl.textContent = 'Empleado';
            mobRoleEl.className = 'text-[10px] bg-blue-500/30 text-blue-300 font-bold px-1.5 py-0.5 rounded uppercase border border-blue-400/20';
        }
    }

    // Mostrar herramientas del personal
    staffEls.forEach(el => el.classList.remove('hidden'));

    // Mostrar herramientas exclusivas del Dueño/Admin
    adminEls.forEach(el => {
        if (u.role === 'admin') {
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    });

    const currentView = document.querySelector('section:not(.hidden)')?.id;
    if (u.role !== 'admin' && currentView === 'view-settings') {
        navigateTo('pos');
    }
    if (currentView === 'view-reports') {
        loadSalesHistory(activeSalesDateFilter);
    }
    updateBulkActionsBar();
    if (window.lucide) lucide.createIcons();
}

// Abrir y cerrar modal de login desde la pestaña superior
async function openUserLoginModal() {
    showScreenLogin();
}

function closeUserLoginModal() {
    hideScreenLogin();
}

// ==================== LÓGICA DE PEDIDOS DIRECTOS DE CLIENTES ====================
let clientCurrentOrderType = 'delivery';
let clientCurrentPaymentMethod = 'cash';

function setClientOrderType(type) {
    clientCurrentOrderType = type;
    const btnDelivery = document.getElementById('btn-mode-delivery');
    const btnTakeaway = document.getElementById('btn-mode-takeaway');
    const addrContainer = document.getElementById('client-delivery-address-container');
    const noticeTakeaway = document.getElementById('client-takeaway-notice');
    const submitText = document.getElementById('btn-client-submit-text');

    if (type === 'delivery') {
        if (btnDelivery) {
            btnDelivery.className = 'py-1.5 px-2.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 bg-blue-600 text-white shadow-sm';
        }
        if (btnTakeaway) {
            btnTakeaway.className = 'py-1.5 px-2.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 bg-transparent text-slate-700 hover:bg-white/60';
        }
        if (addrContainer) addrContainer.classList.remove('hidden');
        if (noticeTakeaway) noticeTakeaway.classList.add('hidden');
        if (submitText) submitText.textContent = 'Confirmar Envío y Abrir WhatsApp';
    } else {
        if (btnDelivery) {
            btnDelivery.className = 'py-1.5 px-2.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 bg-transparent text-slate-700 hover:bg-white/60';
        }
        if (btnTakeaway) {
            btnTakeaway.className = 'py-1.5 px-2.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 bg-blue-600 text-white shadow-sm';
        }
        if (addrContainer) addrContainer.classList.add('hidden');
        if (noticeTakeaway) noticeTakeaway.classList.remove('hidden');
        if (submitText) submitText.textContent = 'Confirmar Retiro y Abrir WhatsApp';
    }
    if (window.lucide) lucide.createIcons();
}

function setClientPaymentMethod(method) {
    clientCurrentPaymentMethod = method;
    const hiddenInput = document.getElementById('client-order-payment-method');
    if (hiddenInput) hiddenInput.value = method;

    const methods = [
        { id: 'btn-pay-cash', key: 'cash', activeClass: 'border-emerald-500 bg-emerald-50 text-emerald-800 shadow-sm' },
        { id: 'btn-pay-transfer', key: 'transfer', activeClass: 'border-blue-500 bg-blue-50 text-blue-800 shadow-sm' },
        { id: 'btn-pay-card', key: 'card', activeClass: 'border-indigo-500 bg-indigo-50 text-indigo-800 shadow-sm' }
    ];

    methods.forEach(m => {
        const btn = document.getElementById(m.id);
        if (!btn) return;
        if (m.key === method) {
            btn.className = `py-2 px-1 rounded-xl text-xs font-bold border-2 transition flex flex-col items-center justify-center gap-0.5 ${m.activeClass}`;
        } else {
            btn.className = 'py-2 px-1 rounded-xl text-xs font-bold border-2 transition flex flex-col items-center justify-center gap-0.5 border-slate-200 bg-white text-slate-700 hover:border-slate-300';
        }
    });
}

async function submitClientDirectOrder() {
    if (State.currentCart.items.length === 0) {
        showToast('Tu pedido está vacío. Toca un producto del catálogo para sumarlo.', 'warn');
        return;
    }

    const nameInput = document.getElementById('client-order-name');
    const phoneInput = document.getElementById('client-order-phone');
    const addressInput = document.getElementById('client-order-address');
    const notesInput = document.getElementById('client-order-notes');

    const customerName = nameInput ? nameInput.value.trim() : '';
    const customerPhone = phoneInput ? phoneInput.value.trim() : '';
    const deliveryAddress = addressInput ? addressInput.value.trim() : '';
    const deliveryNotes = notesInput ? notesInput.value.trim() : '';
    const paymentMethod = clientCurrentPaymentMethod || 'cash';

    if (!customerName) {
        showToast('Por favor ingrese su nombre para el pedido.', 'error');
        if (nameInput) {
            nameInput.focus();
            nameInput.classList.add('ring-2', 'ring-rose-500');
            setTimeout(() => nameInput.classList.remove('ring-2', 'ring-rose-500'), 2500);
        }
        return;
    }

    if (!customerPhone) {
        showToast('Por favor ingrese su número de WhatsApp / teléfono para el aviso.', 'error');
        if (phoneInput) {
            phoneInput.focus();
            phoneInput.classList.add('ring-2', 'ring-rose-500');
            setTimeout(() => phoneInput.classList.remove('ring-2', 'ring-rose-500'), 2500);
        }
        return;
    }

    if (clientCurrentOrderType === 'delivery' && !deliveryAddress) {
        showToast('Por favor ingrese la dirección donde desea recibir su pedido.', 'error');
        if (addressInput) {
            addressInput.focus();
            addressInput.classList.add('ring-2', 'ring-rose-500');
            setTimeout(() => addressInput.classList.remove('ring-2', 'ring-rose-500'), 2500);
        }
        return;
    }

    const rawSubtotal = State.currentCart.items.reduce((acc, i) => acc + i.subtotal, 0);
    const total = rawSubtotal;

    const btn = document.getElementById('btn-client-submit-order');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="animate-spin mr-2">⏳</span> Enviando a Cocina...';
    }

    // Preparar apertura de WhatsApp en el mismo contexto de click del usuario (evita bloqueo de popups)
    let waPreWindow = null;
    const isStaff = isStaffLoggedIn();
    if (!isStaff) {
        try {
            waPreWindow = window.open('about:blank', '_blank');
        } catch (e) {
            waPreWindow = null;
        }
    }

    try {
        const payload = {
            order_type: clientCurrentOrderType,
            customer_name: customerName,
            customer_phone: customerPhone,
            delivery_address: clientCurrentOrderType === 'delivery' ? deliveryAddress : 'Retiro en el local',
            delivery_notes: deliveryNotes,
            payment_method: (currentPosOrderChannel !== 'local') ? `Plataforma (${currentPosOrderChannel.toUpperCase()})` : paymentMethod,
            channel: currentPosOrderChannel || 'local',
            external_order_id: (document.getElementById('pos-external-order-id') ? document.getElementById('pos-external-order-id').value.trim() : ''),
            items: State.currentCart.items,
            subtotal: rawSubtotal,
            total: total
        };

        const res = await fetch('/api/delivery', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.status === 'ok') {
            // Mostrar leyenda en el botón de confirmación
            if (btn) {
                btn.innerHTML = '<span class="flex items-center justify-center gap-2">⏳ <span class="font-black tracking-wider">¡PEDIDO EN PROCESO!</span></span>';
                btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
                btn.classList.add('bg-amber-500', 'text-slate-950');
            }

            // Leyenda flotante destacada
            showToast('⏳ ¡PEDIDO EN PROCESO! — Tu orden #' + (data.order_id || '') + ' fue enviada a la cocina y a WhatsApp', 'success', 5000);
            
            // Pasar la orden completa emitida desde la base de datos
            const finalOrder = data.order || {
                id: data.order_id,
                order_type: clientCurrentOrderType,
                customer_name: customerName,
                customer_phone: customerPhone,
                delivery_address: payload.delivery_address,
                delivery_notes: deliveryNotes,
                payment_method: paymentMethod,
                subtotal: rawSubtotal,
                total: total,
                items: State.currentCart.items,
                created_at: new Date().toISOString()
            };

            const orderId = finalOrder.id || data.order_id;
            latestClientOrderId = orderId;

            // Limpiar comanda
            clearCurrentCart();
            if (addressInput) addressInput.value = '';
            if (notesInput) notesInput.value = '';

            // Cerrar carrito móvil si estuviera abierto
            closeMobileCartModal();

            // Navegar INMEDIATAMENTE a la pestaña de "Pedido en Proceso"
            navigateToOrdersStatus('process');

            // Cargar y actualizar la cartelera de pedidos en vivo de inmediato
            await loadOrdersLiveStatus();

            // Mostrar el banner de aviso de orden reciente en la cartelera
            const alertBanner = document.getElementById('recent-order-alert-banner');
            const alertNum = document.getElementById('recent-order-alert-id');
            if (alertBanner && alertNum) {
                alertNum.textContent = orderId;
                alertBanner.classList.remove('hidden');
            }

            // Abrir el EMERGENTE DE PEDIDO EN PROCESO
            showOrderInProcessPopup(finalOrder, payload);

            // Redirigir directamente al WhatsApp del dueño (+54 9 379 506-2876) con el mensaje completo
            sendOrderToOwnerWhatsApp(finalOrder, waPreWindow);

            // Refrescar cocina si está abierta
            if (typeof loadKitchenOrders === 'function') loadKitchenOrders();
            if (typeof loadDeliveryOrders === 'function') loadDeliveryOrders();
        } else {
            if (waPreWindow && !waPreWindow.closed) {
                try { waPreWindow.close(); } catch(e){}
            }
            showToast(data.error || 'No se pudo enviar el pedido', 'error');
        }
    } catch (err) {
        if (waPreWindow && !waPreWindow.closed) {
            try { waPreWindow.close(); } catch(e){}
        }
        console.error('Error enviando pedido:', err);
        showToast('Error de conexión al enviar el pedido', 'error');
    } finally {
        if (btn) {
            setTimeout(() => {
                btn.disabled = false;
                btn.innerHTML = origHtml;
                btn.classList.remove('bg-amber-500', 'text-slate-950');
                btn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
                if (window.lucide) lucide.createIcons();
            }, 3500);
        }
    }
}

// Variable global con la última orden confirmada para impresión y compartir
let currentSuccessOrderData = null;
let latestClientOrderId = null;

// ==================== EMERGENTE: PEDIDO EN PROCESO ====================
function showOrderInProcessPopup(order, payload = {}) {
    const modal = document.getElementById('modal-order-in-process-popup');
    if (!modal) return;

    currentSuccessOrderData = {
        ...order,
        items: order.items || payload.items || []
    };

    const orderId = order.id || order.order_id || 0;
    const titleEl = document.getElementById('inprocess-popup-order-title');
    const custEl = document.getElementById('inprocess-popup-customer');
    const modeEl = document.getElementById('inprocess-popup-mode');
    const totalEl = document.getElementById('inprocess-popup-total');
    const payEl = document.getElementById('inprocess-popup-payment');

    if (titleEl) titleEl.textContent = `Orden #${orderId}`;
    if (custEl) custEl.textContent = order.customer_name || 'Consumidor';
    
    const isDelivery = order.order_type === 'delivery';
    if (modeEl) {
        modeEl.textContent = isDelivery ? '🛵 Envío a Domicilio' : '🛍️ Retiro en el Local';
    }

    const totalVal = parseFloat(order.total || order.subtotal || 0);
    if (totalEl) totalEl.textContent = formatMoney(totalVal);

    const mapPay = {
        'cash': '💵 Efectivo al recibir',
        'transfer': '📲 QR / Transferencia',
        'card': '💳 Tarjeta Débito / Crédito'
    };
    if (payEl) {
        payEl.textContent = mapPay[order.payment_method] || order.payment_method || 'Efectivo';
    }

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}

function closeOrderInProcessPopup() {
    const modal = document.getElementById('modal-order-in-process-popup');
    if (modal) modal.classList.add('hidden');
    navigateToOrdersStatus('process');

    if (latestClientOrderId) {
        setTimeout(() => {
            const card = document.getElementById(`order-card-${latestClientOrderId}`);
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 150);
    }
}

function openReceiptFromInProcessPopup() {
    const popup = document.getElementById('modal-order-in-process-popup');
    if (popup) popup.classList.add('hidden');
    if (currentSuccessOrderData) {
        showClientOrderSuccessModal(currentSuccessOrderData);
    }
}

function shareReceiptFromInProcessPopup() {
    shareClientReceiptWhatsApp();
}

function showClientOrderSuccessModal(order, payload = {}) {
    const modal = document.getElementById('modal-client-order-success');
    if (!modal) return;

    currentSuccessOrderData = {
        ...order,
        items: order.items || payload.items || []
    };

    // Encabezado
    const numEl = document.getElementById('success-order-number');
    const orderId = order.id || order.order_id || 0;
    if (numEl) numEl.textContent = `Orden #${orderId}`;

    // Datos del comercio en el ticket
    const bizName = document.getElementById('receipt-biz-name');
    const bizSub = document.getElementById('receipt-biz-sub');
    const dateEl = document.getElementById('receipt-datetime');
    const ticketIdEl = document.getElementById('receipt-ticket-id');

    if (bizName) bizName.textContent = State.config.business_name || 'Bien Correntino';
    if (bizSub) bizSub.textContent = State.config.business_subtitle || 'Punto de Venta & Gastronomía Comercial';
    if (ticketIdEl) ticketIdEl.textContent = `COMPROBANTE DE PEDIDO #${orderId}`;

    const dateStr = order.created_at ? new Date(order.created_at.replace(' ', 'T')).toLocaleString('es-AR') : new Date().toLocaleString('es-AR');
    if (dateEl) dateEl.textContent = `Fecha: ${dateStr}`;

    // Datos del cliente y modalidad
    const nameEl = document.getElementById('receipt-customer-name');
    const phoneEl = document.getElementById('receipt-customer-phone');
    const modeEl = document.getElementById('receipt-order-mode');
    const addrRow = document.getElementById('receipt-address-row');
    const addrEl = document.getElementById('receipt-customer-address');
    const notesRow = document.getElementById('receipt-notes-row');
    const notesEl = document.getElementById('receipt-customer-notes');

    if (nameEl) nameEl.textContent = order.customer_name || 'Consumidor';
    if (phoneEl) phoneEl.textContent = order.customer_phone || 'S/D';

    const isDelivery = order.order_type === 'delivery';
    if (modeEl) {
        modeEl.textContent = isDelivery ? '🛵 ENVÍO A DOMICILIO' : '🛍️ RETIRO EN EL LOCAL';
        modeEl.className = isDelivery ? 'font-black text-blue-700 uppercase' : 'font-black text-emerald-700 uppercase';
    }

    if (addrRow && addrEl) {
        if (isDelivery && order.delivery_address) {
            addrRow.classList.remove('hidden');
            addrEl.textContent = order.delivery_address;
        } else {
            addrRow.classList.add('hidden');
        }
    }

    if (notesRow && notesEl) {
        if (order.delivery_notes) {
            notesRow.classList.remove('hidden');
            notesEl.textContent = order.delivery_notes;
        } else {
            notesRow.classList.add('hidden');
        }
    }

    // Lista de ítems en el comprobante
    const itemsListEl = document.getElementById('receipt-items-list');
    const items = currentSuccessOrderData.items || [];
    if (itemsListEl) {
        if (items.length === 0) {
            itemsListEl.innerHTML = '<div class="text-slate-400 py-1">Sin ítems detallados</div>';
        } else {
            itemsListEl.innerHTML = items.map(it => {
                const qty = it.quantity || 1;
                const price = parseFloat(it.price || it.sale_price || it.unit_price || 0);
                const sub = parseFloat(it.subtotal || (price * qty));
                const name = it.name || it.product_name || 'Producto';
                return `
                    <div class="flex justify-between items-start py-1 border-b border-slate-100 last:border-0">
                        <div class="max-w-[72%]">
                            <span class="font-black text-slate-900">${qty}x</span>
                            <span class="text-slate-800">${name}</span>
                            ${it.notes ? `<div class="text-[10px] text-amber-700 font-semibold mt-0.5">⚠️ ${it.notes}</div>` : ''}
                        </div>
                        <div class="font-bold text-slate-900">${formatMoney(sub)}</div>
                    </div>
                `;
            }).join('');
        }
    }

    // Totales y pago
    const subEl = document.getElementById('receipt-subtotal');
    const totalEl = document.getElementById('receipt-total');
    const payEl = document.getElementById('receipt-payment-method');

    const subtotalVal = parseFloat(order.subtotal || order.total || 0);
    const totalVal = parseFloat(order.total || subtotalVal);

    if (subEl) subEl.textContent = formatMoney(subtotalVal);
    if (totalEl) totalEl.textContent = formatMoney(totalVal);

    const mapPay = {
        'cash': '💵 Efectivo al recibir',
        'transfer': '📲 QR / Transferencia',
        'card': '💳 Tarjeta Débito / Crédito'
    };
    if (payEl) {
        payEl.textContent = mapPay[order.payment_method] || order.payment_method || 'Efectivo';
    }

    // Estado del pedido en el comprobante
    const receiptStatusEl = document.getElementById('receipt-status-text');
    if (receiptStatusEl) {
        if (order.status === 'ready') {
            receiptStatusEl.textContent = '✅ PEDIDO LISTO PARA RETIRAR';
            receiptStatusEl.className = 'font-bold text-emerald-600';
        } else {
            receiptStatusEl.textContent = '🟡 TOMADO / EN PROCESO (COCINA)';
            receiptStatusEl.className = 'font-bold text-amber-600';
        }
    }

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}

function printClientReceipt() {
    window.print();
}

// ==================== ENVÍO AUTOMÁTICO DE PEDIDOS A WHATSAPP DEL DUEÑO ====================
function getOwnerWhatsAppNumber() {
    // Número del dueño: +543795062876 -> 5493795062876 (formato internacional WhatsApp Argentina)
    let raw = (State.config.phone || '+543795062876').replace(/\D/g, '');
    if (!raw) raw = '5493795062876';

    if (raw.startsWith('54') && !raw.startsWith('549')) {
        raw = '549' + raw.slice(2);
    } else if (raw.startsWith('0')) {
        raw = '549' + raw.slice(1);
    } else if (!raw.startsWith('54')) {
        raw = '549' + raw;
    }
    return raw;
}

function buildWhatsAppOrderMessage(ord) {
    const bizName = State.config.business_name || 'biencorrentino';
    const orderId = ord.id || ord.order_id || '';
    const isDelivery = ord.order_type === 'delivery';

    let msg = `👋 *¡HOLA ${bizName.toUpperCase()}! NUEVO PEDIDO #${orderId}*\n\n`;
    msg += `👤 *Cliente:* ${ord.customer_name || 'Cliente'}\n`;
    if (ord.customer_phone) msg += `📞 *Teléfono:* ${ord.customer_phone}\n`;
    msg += `📦 *Modalidad:* ${isDelivery ? '🛵 Envío a Domicilio' : '🛍️ Retiro en el Local'}\n`;
    if (isDelivery && ord.delivery_address) {
        msg += `📍 *Dirección:* ${ord.delivery_address}\n`;
    }
    if (ord.delivery_notes) {
        msg += `📝 *Aclaraciones:* ${ord.delivery_notes}\n`;
    }
    msg += `\n🛒 *DETALLE DE PRODUCTOS:*\n`;
    (ord.items || []).forEach(it => {
        const qty = it.quantity || 1;
        const price = parseFloat(it.price || it.sale_price || it.unit_price || 0);
        const sub = parseFloat(it.subtotal || (price * qty));
        const name = it.name || it.product_name || 'Producto';
        msg += `• *${qty}x* ${name} - ${formatMoney(sub)}\n`;
        if (it.notes) msg += `   _(Nota: ${it.notes})_\n`;
    });
    msg += `\n💰 *TOTAL A PAGAR: ${formatMoney(ord.total || ord.subtotal || 0)}*\n`;
    const mapPay = {
        'cash': '💵 Efectivo al recibir',
        'transfer': '📲 Transferencia / QR',
        'card': '💳 Tarjeta Débito / Crédito'
    };
    msg += `💳 *Medio de Pago:* ${mapPay[ord.payment_method] || ord.payment_method || 'Efectivo'}\n`;
    msg += `\n_Pedido enviado automáticamente desde la App de ${bizName}_`;
    return msg;
}

function sendOrderToOwnerWhatsApp(order = null, preWindow = null) {
    const ord = order || currentSuccessOrderData;
    if (!ord) return;

    const phone = getOwnerWhatsAppNumber();
    const msg = buildWhatsAppOrderMessage(ord);
    const encoded = encodeURIComponent(msg);
    // URL estándar con compatibilidad universal tanto para celular como PC
    const waUrl = `https://api.whatsapp.com/send?phone=${phone}&text=${encoded}`;

    if (preWindow && !preWindow.closed) {
        try {
            preWindow.location.href = waUrl;
            return;
        } catch (e) {
            console.warn('Error redirigiendo ventana preabierta:', e);
        }
    }

    try {
        const win = window.open(waUrl, '_blank');
        if (!win || win.closed || typeof win.closed === 'undefined') {
            window.location.href = waUrl;
        }
    } catch (e) {
        window.location.href = waUrl;
    }
}

function shareClientReceiptWhatsApp() {
    sendOrderToOwnerWhatsApp();
}

function closeClientOrderSuccessModal() {
    const modal = document.getElementById('modal-client-order-success');
    if (modal) modal.classList.add('hidden');
    closeMobileCartModal();
    navigateToOrdersStatus('process');

    if (latestClientOrderId) {
        setTimeout(() => {
            const card = document.getElementById(`order-card-${latestClientOrderId}`);
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 150);
    }
}

function openRecentOrderReceipt() {
    if (currentSuccessOrderData) {
        showClientOrderSuccessModal(currentSuccessOrderData);
    } else if (latestClientOrderId) {
        openClientOrderReceiptFromList(latestClientOrderId);
    }
}

function dismissRecentOrderAlert() {
    const banner = document.getElementById('recent-order-alert-banner');
    if (banner) banner.classList.add('hidden');
}

// ==================== CARTELERA DE PEDIDOS EN VIVO (EN PROCESO / LISTOS) ====================
let currentOrdersStatusSubtab = 'process'; // 'process' | 'ready'
let cachedOrdersLiveStatus = { in_process: [], ready: [] };

function navigateToOrdersStatus(subtab = 'process') {
    navigateTo('orders-status');
    setOrdersStatusSubtab(subtab);
}

function setOrdersStatusSubtab(subtab) {
    currentOrdersStatusSubtab = subtab;
    const btnProcess = document.getElementById('tab-btn-process');
    const btnReady = document.getElementById('tab-btn-ready');
    const panelProcess = document.getElementById('panel-orders-process');
    const panelReady = document.getElementById('panel-orders-ready');

    const navProcess = document.getElementById('nav-orders-process');
    const navReady = document.getElementById('nav-orders-ready');

    // Botones de barra inferior móvil
    const mobNavProcess = document.getElementById('mob-nav-process');
    const mobNavReady = document.getElementById('mob-nav-ready');
    const mobNavPos = document.getElementById('mob-nav-pos');

    // Tabs superiores móvil en view-pos
    const topMobPos = document.getElementById('mob-top-tab-pos');
    const topMobProc = document.getElementById('mob-top-tab-process');
    const topMobReady = document.getElementById('mob-top-tab-ready');

    // Tabs superiores móvil en view-orders-status
    const mobStatusPos = document.getElementById('mob-orders-status-tab-pos');
    const mobStatusProc = document.getElementById('mob-orders-status-tab-process');
    const mobStatusReady = document.getElementById('mob-orders-status-tab-ready');

    // Reset general
    if (navProcess) {
        navProcess.classList.remove('text-white', 'bg-amber-600', 'shadow-sm');
        navProcess.classList.add('text-slate-400');
    }
    if (navReady) {
        navReady.classList.remove('text-white', 'bg-emerald-600', 'shadow-sm');
        navReady.classList.add('text-slate-400');
    }

    if (mobNavPos) {
        mobNavPos.classList.remove('text-blue-500');
        mobNavPos.classList.add('text-slate-400');
    }

    if (subtab === 'process') {
        // Desktop Tabs
        if (btnProcess) {
            btnProcess.className = 'flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition bg-amber-500 text-slate-950 shadow';
        }
        if (btnReady) {
            btnReady.className = 'flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition text-slate-400 hover:text-slate-200';
        }
        if (panelProcess) panelProcess.classList.remove('hidden');
        if (panelReady) panelReady.classList.add('hidden');

        if (navProcess) {
            navProcess.classList.remove('text-slate-400');
            navProcess.classList.add('text-white', 'bg-amber-600', 'shadow-sm');
        }

        // Bottom mobile nav
        if (mobNavProcess) {
            mobNavProcess.className = 'flex-1 flex flex-col items-center justify-center py-1 text-amber-400 font-bold transition';
        }
        if (mobNavReady) {
            mobNavReady.className = 'flex-1 flex flex-col items-center justify-center py-1 text-slate-400 hover:text-slate-200 transition';
        }

        // Top mobile tabs (POS)
        if (topMobProc) {
            topMobProc.className = 'flex-1 py-2 px-2 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition bg-amber-500 text-slate-950 shadow-sm';
        }
        if (topMobReady) {
            topMobReady.className = 'flex-1 py-2 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition text-slate-400 hover:text-slate-200';
        }

        // Top mobile tabs (Orders Status view)
        if (mobStatusProc) {
            mobStatusProc.className = 'flex-1 py-2 px-2 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition bg-amber-500 text-slate-950 shadow-sm';
        }
        if (mobStatusReady) {
            mobStatusReady.className = 'flex-1 py-2 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition text-slate-400 hover:text-white';
        }
    } else {
        // Desktop Tabs
        if (btnProcess) {
            btnProcess.className = 'flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition text-slate-400 hover:text-slate-200';
        }
        if (btnReady) {
            btnReady.className = 'flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition bg-emerald-500 text-slate-950 shadow';
        }
        if (panelProcess) panelProcess.classList.add('hidden');
        if (panelReady) panelReady.classList.remove('hidden');

        if (navReady) {
            navReady.classList.remove('text-slate-400');
            navReady.classList.add('text-white', 'bg-emerald-600', 'shadow-sm');
        }

        // Bottom mobile nav
        if (mobNavProcess) {
            mobNavProcess.className = 'flex-1 flex flex-col items-center justify-center py-1 text-slate-400 hover:text-slate-200 transition';
        }
        if (mobNavReady) {
            mobNavReady.className = 'flex-1 flex flex-col items-center justify-center py-1 text-emerald-400 font-bold transition';
        }

        // Top mobile tabs (POS)
        if (topMobProc) {
            topMobProc.className = 'flex-1 py-2 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition text-slate-400 hover:text-slate-200';
        }
        if (topMobReady) {
            topMobReady.className = 'flex-1 py-2 px-2 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition bg-emerald-500 text-slate-950 shadow-sm';
        }

        // Top mobile tabs (Orders Status view)
        if (mobStatusProc) {
            mobStatusProc.className = 'flex-1 py-2 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition text-slate-400 hover:text-white';
        }
        if (mobStatusReady) {
            mobStatusReady.className = 'flex-1 py-2 px-2 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition bg-emerald-500 text-slate-950 shadow-sm';
        }
    }

    if (window.lucide) lucide.createIcons();
}

// ==================== SISTEMA DE AVISOS Y TIMBRE DE NUEVOS PEDIDOS (PERSONAL Y DUEÑO) ====================
let lastStaffKnownOrderId = null;
let staffAudioContext = null;
let tabTitleOriginal = document.title || 'POSBerry';
let tabTitleInterval = null;
let latestStaffAlertOrderId = null;

function isStaffLoggedIn() {
    return !!(State.isAuthenticated && State.currentUser && (State.currentUser.role === 'admin' || State.currentUser.role === 'empleado'));
}

function getStaffAudioContext() {
    if (!staffAudioContext) {
        const AudioClass = window.AudioContext || window.webkitAudioContext;
        if (AudioClass) {
            staffAudioContext = new AudioClass();
        }
    }
    if (staffAudioContext && staffAudioContext.state === 'suspended') {
        staffAudioContext.resume();
    }
    return staffAudioContext;
}

// Desbloquear audio automáticamente con cualquier toque o interacción
['click', 'touchstart', 'keydown'].forEach(evt => {
    document.addEventListener(evt, () => {
        if (staffAudioContext && staffAudioContext.state === 'suspended') {
            staffAudioContext.resume();
        }
    }, { passive: true });
});

function initStaffAudioAndNotifications() {
    getStaffAudioContext();
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
    }
}

function playOrderNotificationSound() {
    try {
        const ctx = getStaffAudioContext();
        if (!ctx) return;

        const now = ctx.currentTime;
        
        // Secuencia armónica alegre de timbre de restaurante (Do - Mi - Sol - Do agudo)
        const chord = [
            { freq: 523.25, time: 0.00, dur: 0.18 },
            { freq: 659.25, time: 0.12, dur: 0.18 },
            { freq: 783.99, time: 0.24, dur: 0.22 },
            { freq: 1046.50, time: 0.38, dur: 0.55 }
        ];

        // Se reproduce un doble repique para máxima claridad sonora
        [0, 0.65].forEach(rep => {
            chord.forEach(n => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();

                osc.type = 'triangle'; // Sonido agradable tipo campana
                osc.frequency.setValueAtTime(n.freq, now + rep + n.time);

                gain.gain.setValueAtTime(0.001, now + rep + n.time);
                gain.gain.exponentialRampToValueAtTime(0.45, now + rep + n.time + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, now + rep + n.time + n.dur);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start(now + rep + n.time);
                osc.stop(now + rep + n.time + n.dur);
            });
        });

        // Vibración en dispositivos móviles compatibles
        if (navigator.vibrate) {
            navigator.vibrate([300, 150, 300, 150, 400]);
        }
    } catch (e) {
        console.warn('Error reproduciendo timbre:', e);
    }
}

function testOrderSoundNotification() {
    initStaffAudioAndNotifications();
    playOrderNotificationSound();
    showToast('🔔 ¡Timbre de aviso activado! Sonará cuando entre un pedido.', 'success', 4000);
}

function checkNewIncomingOrdersForStaff(inProcessOrders = [], readyOrders = []) {
    const allOrders = [...inProcessOrders, ...readyOrders];
    const orderIds = allOrders.map(o => o.id).filter(Boolean);
    const maxId = orderIds.length > 0 ? Math.max(...orderIds) : 0;

    // Primer chequeo al iniciar la app: solo memorizar el ID más alto existente
    if (lastStaffKnownOrderId === null) {
        lastStaffKnownOrderId = maxId;
        return;
    }

    // Detectar si ingresó una o más órdenes nuevas
    if (maxId > lastStaffKnownOrderId) {
        const newOrders = inProcessOrders.filter(o => o.id > lastStaffKnownOrderId);
        lastStaffKnownOrderId = maxId;

        // Solo notificar si quien está operando es empleado o dueño
        if (newOrders.length > 0 && isStaffLoggedIn()) {
            const newest = newOrders[0];
            triggerStaffNewOrderAlert(newest);
        }
    }
}

function triggerStaffNewOrderAlert(order) {
    latestStaffAlertOrderId = order.id;

    // 1. Reproducir sonido del timbre
    playOrderNotificationSound();

    // 2. Mostrar banner flotante visual
    const banner = document.getElementById('banner-new-order-staff-alert');
    if (banner) {
        const titleEl = document.getElementById('staff-alert-order-title');
        const custEl = document.getElementById('staff-alert-customer');
        const modeEl = document.getElementById('staff-alert-mode-badge');
        const totalEl = document.getElementById('staff-alert-total');
        const itemsEl = document.getElementById('staff-alert-items-summary');

        if (titleEl) titleEl.textContent = `Orden #${order.id}`;
        if (custEl) custEl.textContent = order.customer_name || 'Consumidor Final';
        
        const isDelivery = order.order_type === 'delivery';
        const isPY = order.channel === 'pedidosya';
        const isRP = order.channel === 'rappi';
        if (modeEl) {
            if (isPY) {
                modeEl.textContent = '🔴 PedidosYa' + (order.external_order_id ? ` #${order.external_order_id}` : '');
                modeEl.className = 'px-2 py-0.5 rounded-md bg-red-600 text-white text-[10px] uppercase font-black tracking-wide border border-red-500 shadow';
            } else if (isRP) {
                modeEl.textContent = '🟠 Rappi' + (order.external_order_id ? ` #${order.external_order_id}` : '');
                modeEl.className = 'px-2 py-0.5 rounded-md bg-orange-600 text-white text-[10px] uppercase font-black tracking-wide border border-orange-500 shadow';
            } else {
                modeEl.textContent = isDelivery ? '🛵 Delivery' : '🛍️ Retiro';
                modeEl.className = isDelivery 
                    ? 'px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 text-[10px] uppercase font-black tracking-wide border border-blue-400/30'
                    : 'px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] uppercase font-black tracking-wide border border-emerald-400/30';
            }
        }

        const totalVal = parseFloat(order.total || order.subtotal || 0);
        if (totalEl) totalEl.textContent = formatMoney(totalVal);

        if (itemsEl) {
            const items = order.items || [];
            if (items.length > 0) {
                itemsEl.textContent = items.map(i => `${i.quantity || 1}x ${i.product_name || i.name}`).join(' • ');
            } else {
                itemsEl.textContent = 'Pedido directo de cliente';
            }
        }

        banner.classList.remove('hidden');
        if (window.lucide) lucide.createIcons();
    }

    // 3. Notificación nativa de escritorio / celular del navegador
    if ("Notification" in window && Notification.permission === "granted") {
        try {
            const mode = order.order_type === 'delivery' ? '🛵 Envío a Domicilio' : '🛍️ Retiro en Local';
            new Notification(`🔔 ¡Nuevo Pedido #${order.id}!`, {
                body: `${mode} - ${order.customer_name || 'Cliente'} ($${formatMoney(order.total || 0)})`,
                icon: '/static/icons/icon-192.png',
                tag: 'order-' + order.id
            });
        } catch (e) {}
    }

    // 4. Parpadeo de aviso en el título de la pestaña
    startTabTitleAlert(order.id);

    // 5. Refrescar vistas operativas si están activas
    if (typeof loadKitchenOrders === 'function') loadKitchenOrders();
    if (typeof loadDeliveryOrders === 'function') loadDeliveryOrders();
}

function dismissNewOrderStaffAlert() {
    const banner = document.getElementById('banner-new-order-staff-alert');
    if (banner) banner.classList.add('hidden');
    stopTabTitleAlert();
}

function goToNewOrderLocation() {
    dismissNewOrderStaffAlert();
    navigateToOrdersStatus('process');

    if (latestStaffAlertOrderId) {
        setTimeout(() => {
            const card = document.getElementById(`order-card-${latestStaffAlertOrderId}`);
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.classList.add('ring-4', 'ring-amber-400');
                setTimeout(() => card.classList.remove('ring-4', 'ring-amber-400'), 4000);
            }
        }, 200);
    }
}

function startTabTitleAlert(orderId) {
    stopTabTitleAlert();
    let toggle = false;
    tabTitleInterval = setInterval(() => {
        document.title = toggle ? `🔔 (1) ¡NUEVO PEDIDO #${orderId}! 🔔` : '⚠️ NUEVO PEDIDO — POSBerry';
        toggle = !toggle;
    }, 900);

    const onUserInteract = () => {
        stopTabTitleAlert();
        window.removeEventListener('click', onUserInteract);
        window.removeEventListener('focus', onUserInteract);
    };
    window.addEventListener('click', onUserInteract);
    window.addEventListener('focus', onUserInteract);
}

function stopTabTitleAlert() {
    if (tabTitleInterval) {
        clearInterval(tabTitleInterval);
        tabTitleInterval = null;
    }
    document.title = tabTitleOriginal || 'POSBerry';
}

async function loadOrdersLiveStatus() {
    try {
        const res = await fetch('/api/orders/live_status');
        if (!res.ok) return;
        const data = await res.json();
        if (data.status !== 'ok') return;

        cachedOrdersLiveStatus = {
            in_process: data.in_process || [],
            ready: data.ready || []
        };

        // Comprobar y notificar si hay nuevos pedidos al personal logueado
        checkNewIncomingOrdersForStaff(cachedOrdersLiveStatus.in_process, cachedOrdersLiveStatus.ready);

        const countProcess = cachedOrdersLiveStatus.in_process.length;
        const countReady = cachedOrdersLiveStatus.ready.length;

        // Actualizar badges en sidebar desktop
        const badgeProcess = document.getElementById('badge-orders-process');
        const badgeReady = document.getElementById('badge-orders-ready');
        if (badgeProcess) badgeProcess.textContent = countProcess;
        if (badgeReady) badgeReady.textContent = countReady;

        // Actualizar badges en header móvil
        const badgeProcessMob = document.getElementById('badge-orders-process-mob');
        const badgeReadyMob = document.getElementById('badge-orders-ready-mob');
        if (badgeProcessMob) badgeProcessMob.textContent = countProcess;
        if (badgeReadyMob) badgeReadyMob.textContent = countReady;

        // Actualizar badges en barra inferior fija para celular
        const mobBadgeProc = document.getElementById('mob-badge-orders-process');
        const mobBadgeRdy = document.getElementById('mob-badge-orders-ready');
        if (mobBadgeProc) mobBadgeProc.textContent = countProcess;
        if (mobBadgeRdy) mobBadgeRdy.textContent = countReady;

        // Actualizar badges en barra superior móvil de POS
        const mobTopBadgeProc = document.getElementById('mob-top-badge-process');
        const mobTopBadgeRdy = document.getElementById('mob-top-badge-ready');
        if (mobTopBadgeProc) mobTopBadgeProc.textContent = countProcess;
        if (mobTopBadgeRdy) mobTopBadgeRdy.textContent = countReady;

        // Actualizar badges en barra superior móvil de Orders Status
        const mobStatusBadgeProc = document.getElementById('mob-orders-status-badge-process');
        const mobStatusBadgeRdy = document.getElementById('mob-orders-status-badge-ready');
        if (mobStatusBadgeProc) mobStatusBadgeProc.textContent = countProcess;
        if (mobStatusBadgeRdy) mobStatusBadgeRdy.textContent = countReady;

        // Actualizar badges en tabs de la propia vista desktop
        const tabBadgeProcess = document.getElementById('orders-status-tab-badge-process');
        const tabBadgeReady = document.getElementById('orders-status-tab-badge-ready');
        if (tabBadgeProcess) tabBadgeProcess.textContent = countProcess;
        if (tabBadgeReady) tabBadgeReady.textContent = countReady;

        // Renderizar grids
        renderOrdersStatusCards('process', cachedOrdersLiveStatus.in_process);
        renderOrdersStatusCards('ready', cachedOrdersLiveStatus.ready);

    } catch (e) {
        console.warn('Error fetching orders live status:', e);
    }
}

function renderOrdersStatusCards(type, ordersList) {
    const container = document.getElementById(type === 'process' ? 'grid-orders-process' : 'grid-orders-ready');
    if (!container) return;

    if (!ordersList || ordersList.length === 0) {
        container.innerHTML = `
            <div class="col-span-full py-12 flex flex-col items-center justify-center text-slate-500 bg-slate-900/60 rounded-3xl border border-dashed border-slate-800 p-8 text-center">
                <div class="w-14 h-14 rounded-2xl ${type === 'process' ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'} flex items-center justify-center mb-3">
                    <i data-lucide="${type === 'process' ? 'clock' : 'check-circle-2'}" class="w-7 h-7"></i>
                </div>
                <h4 class="font-bold text-slate-300 text-base">No hay pedidos ${type === 'process' ? 'en proceso' : 'listos'} en este momento</h4>
                <p class="text-xs text-slate-400 max-w-sm mt-1">
                    ${type === 'process' ? 'Los nuevos pedidos confirmados aparecerán aquí automáticamente mientras se cocinan.' : 'Cuando la cocina termine un pedido, se moverá a esta sección para ser retirado.'}
                </p>
                <button onclick="navigateTo('pos')" class="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow">
                    <i data-lucide="shopping-cart" class="w-4 h-4"></i>
                    <span>Hacer un Nuevo Pedido</span>
                </button>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    container.innerHTML = ordersList.map(ord => {
        const isDelivery = ord.order_type === 'delivery';
        const orderId = ord.id;
        const total = formatMoney(ord.total || ord.subtotal || 0);
        const timeStr = ord.created_at ? new Date(ord.created_at.replace(' ', 'T')).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';
        const items = ord.items || [];
        const isReady = type === 'ready';

        const isMyRecent = (ord.id === latestClientOrderId);
        let borderClasses = isReady 
            ? 'border-emerald-500/40 shadow-lg shadow-emerald-500/10' 
            : 'border-amber-500/30 shadow-lg shadow-amber-500/5';
        if (isMyRecent) {
            borderClasses = 'border-amber-400 ring-2 ring-amber-400 shadow-xl shadow-amber-500/25 bg-slate-900';
        }

        return `
            <div id="order-card-${orderId}" class="bg-slate-900/90 rounded-3xl border ${borderClasses} p-4 flex flex-col justify-between transition hover:border-slate-500 space-y-3 relative">
                <!-- Cabecera de la Tarjeta -->
                <div class="flex items-start justify-between border-b border-slate-800 pb-2.5">
                    <div>
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="text-xl font-black text-white tracking-tight">#${orderId}</span>
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${isReady ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' : 'bg-amber-500/20 text-amber-300 border border-amber-400/30 flex items-center gap-1'}">
                                ${!isReady ? '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span>' : ''}
                                ${isReady ? '✅ LISTO' : '⏳ EN PROCESO'}
                            </span>
                            ${ord.channel === 'pedidosya' ? `
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-red-600 text-white flex items-center gap-1 shadow">
                                    🔴 PedidosYa ${ord.external_order_id ? '#' + ord.external_order_id : ''}
                                </span>
                            ` : ord.channel === 'rappi' ? `
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-orange-600 text-white flex items-center gap-1 shadow">
                                    🟠 Rappi ${ord.external_order_id ? '#' + ord.external_order_id : ''}
                                </span>
                            ` : ''}
                            ${isMyRecent ? `
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-400 text-slate-950 flex items-center gap-1 shadow animate-pulse">
                                    ⭐ Tu Pedido
                                </span>
                            ` : ''}
                        </div>
                        <div class="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                            <i data-lucide="clock" class="w-3 h-3 text-slate-400"></i>
                            <span>Tomado a las ${timeStr} hs</span>
                        </div>
                    </div>

                    <span class="text-[11px] font-black px-2.5 py-1 rounded-xl ${isDelivery ? 'bg-blue-950/80 text-blue-300 border border-blue-500/30' : 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'} flex items-center gap-1">
                        <i data-lucide="${isDelivery ? 'truck' : 'shopping-bag'}" class="w-3.5 h-3.5"></i>
                        <span>${isDelivery ? 'Envío' : 'Retiro'}</span>
                    </span>
                </div>

                <!-- Datos del Cliente -->
                <div class="bg-slate-950/50 rounded-2xl p-2.5 border border-slate-800/80 text-xs space-y-1">
                    <div class="flex items-center justify-between">
                        <span class="text-slate-400">Cliente:</span>
                        <span class="font-bold text-white">${ord.customer_name || 'Consumidor'}</span>
                    </div>
                    ${ord.customer_phone ? `
                        <div class="flex items-center justify-between">
                            <span class="text-slate-400">Tel:</span>
                            <span class="font-medium text-slate-300">${ord.customer_phone}</span>
                        </div>
                    ` : ''}
                    ${isDelivery && ord.delivery_address ? `
                        <div class="text-[11px] text-slate-300 pt-1 border-t border-slate-800 flex items-start gap-1">
                            <i data-lucide="map-pin" class="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5"></i>
                            <span class="line-clamp-2">${ord.delivery_address}</span>
                        </div>
                    ` : ''}
                </div>

                <!-- Detalle Resumido de Productos -->
                <div class="text-xs space-y-1 py-1 max-h-28 overflow-y-auto pr-1">
                    ${items.map(it => `
                        <div class="flex items-center justify-between text-slate-300 text-[11px]">
                            <span class="truncate max-w-[75%]"><strong class="text-white">${it.quantity || 1}x</strong> ${it.product_name || 'Ítem'}</span>
                            <span class="font-mono text-slate-400">${formatMoney(it.subtotal || 0)}</span>
                        </div>
                    `).join('')}
                </div>

                <!-- Total y Botón Comprobante -->
                <div class="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
                    <div>
                        <div class="text-[10px] text-slate-400 uppercase tracking-wider">Total</div>
                        <div class="text-sm font-black text-emerald-400 font-mono">${total}</div>
                    </div>
                    <button type="button" onclick="openClientOrderReceiptFromList(${orderId})"
                        class="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-slate-700 shadow-sm active:scale-95">
                        <i data-lucide="receipt" class="w-3.5 h-3.5 text-blue-400"></i>
                        <span>Ver Comprobante</span>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

function openClientOrderReceiptFromList(orderId) {
    const all = [...cachedOrdersLiveStatus.in_process, ...cachedOrdersLiveStatus.ready];
    const target = all.find(o => o.id === orderId);
    if (!target) {
        showToast('No se encontró el comprobante del pedido', 'error');
        return;
    }
    showClientOrderSuccessModal(target);
}

// ==================== MODAL CAMBIAR PIN / CONTRASEÑA ====================

function openChangePinModal(preselectedUserId = null) {
    const modal = document.getElementById('modal-change-pin');
    if (!modal) return;

    const select = document.getElementById('change-pin-user-select');
    if (select) {
        const users = (State.loginUsersList && State.loginUsersList.length) ? State.loginUsersList : [
            { id: 1, name: 'Dueño / Admin', role: 'admin' },
            { id: 2, name: 'Empleado Mostrador', role: 'empleado' }
        ];
        select.innerHTML = users.map(u => `
            <option value="${u.id}">${u.name} (${u.role === 'admin' ? 'Dueño' : 'Empleado'})</option>
        `).join('');

        const targetId = preselectedUserId || State.currentUser?.id || State.selectedLoginUserId || users[0].id;
        select.value = targetId;
    }

    document.getElementById('change-pin-current').value = '';
    document.getElementById('change-pin-new').value = '';
    document.getElementById('change-pin-confirm').value = '';
    const msg = document.getElementById('change-pin-msg');
    if (msg) {
        msg.classList.add('hidden');
        msg.textContent = '';
    }

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}

function closeChangePinModal() {
    const modal = document.getElementById('modal-change-pin');
    if (modal) modal.classList.add('hidden');
}

async function submitChangePin(e) {
    e.preventDefault();
    const userId = parseInt(document.getElementById('change-pin-user-select').value);
    const currentPin = document.getElementById('change-pin-current').value.trim();
    const newPin = document.getElementById('change-pin-new').value.trim();
    const confirmPin = document.getElementById('change-pin-confirm').value.trim();

    if (!currentPin || !newPin) {
        showChangePinMsg('Debe ingresar el PIN actual y el nuevo PIN', 'error');
        return;
    }
    if (newPin.length < 4) {
        showChangePinMsg('El nuevo PIN debe tener al menos 4 dígitos', 'error');
        return;
    }
    if (newPin !== confirmPin) {
        showChangePinMsg('La confirmación del nuevo PIN no coincide', 'error');
        return;
    }

    try {
        const res = await fetch('/api/auth/change_pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: userId,
                current_pin: currentPin,
                new_pin: newPin,
                confirm_pin: confirmPin
            })
        });
        const data = await res.json();
        if (data.status === 'ok') {
            showChangePinMsg(data.message || '¡PIN actualizado exitosamente!', 'success');
            showToast('¡PIN actualizado correctamente!', 'success');
            setTimeout(() => {
                closeChangePinModal();
            }, 1600);
        } else {
            showChangePinMsg(data.error || 'No se pudo actualizar el PIN', 'error');
        }
    } catch (err) {
        console.error('Error actualizando PIN:', err);
        showChangePinMsg('Error de conexión con el servidor', 'error');
    }
}

function showChangePinMsg(text, type) {
    const el = document.getElementById('change-pin-msg');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden', 'bg-rose-50', 'text-rose-700', 'bg-emerald-50', 'text-emerald-700');
    if (type === 'success') {
        el.classList.add('bg-emerald-50', 'text-emerald-700');
    } else {
        el.classList.add('bg-rose-50', 'text-rose-700');
    }
}

// ==================== MONITOREO DE EMPLEADOS EN VIVO (DUEÑO) ====================
async function loadLiveMonitoringData() {
    if (State.currentUser?.role !== 'admin') return;
    try {
        const res = await fetch('/api/reports/live_monitoring');
        if (res.status === 403) return;
        const data = await res.json();
        if (data.status !== 'ok') return;

        // Renderizar tarjetas de cada empleado
        const grid = document.getElementById('live-employees-grid');
        if (grid) {
            grid.innerHTML = (data.employees_stats || []).map(emp => `
                <div class="p-3 rounded-xl border ${emp.role === 'admin' ? 'border-amber-200 bg-amber-50/60' : 'border-blue-200 bg-blue-50/60'} space-y-2">
                    <div class="flex items-center justify-between">
                        <span class="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                            <span class="w-2.5 h-2.5 rounded-full ${emp.role === 'admin' ? 'bg-amber-500' : 'bg-blue-500'}"></span>
                            ${emp.user_name}
                        </span>
                        <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${emp.role === 'admin' ? 'bg-amber-200 text-amber-900' : 'bg-blue-200 text-blue-900'}">
                            ${emp.role === 'admin' ? 'Dueño' : 'Empleado'}
                        </span>
                    </div>
                    <div class="grid grid-cols-2 gap-2 text-xs">
                        <div>
                            <span class="text-slate-400 block text-[10px]">Vendido Hoy</span>
                            <span class="font-black text-sm text-slate-900">${formatMoney(emp.total_sold)}</span>
                        </div>
                        <div>
                            <span class="text-slate-400 block text-[10px]">Operaciones</span>
                            <span class="font-bold text-sm text-blue-600">${emp.tickets_count} tickets</span>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        // Renderizar tabla de actividad reciente en vivo
        const tbody = document.getElementById('live-activity-tbody');
        if (tbody) {
            if (!data.recent_activity || data.recent_activity.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">Sin ventas registradas en el día de hoy</td></tr>`;
            } else {
                tbody.innerHTML = data.recent_activity.map(act => {
                    const timeStr = act.closed_at ? new Date(act.closed_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '-';
                    const itemsDesc = (act.items || []).map(i => `${i.quantity}x ${i.product_name}`).join(', ') || 'Venta general';
                    const methodNames = {
                        'cash': 'Efectivo',
                        'card_debit': 'Débito',
                        'card_credit': 'Crédito',
                        'transfer': 'QR/Transf',
                        'credit': 'Cta Cte'
                    };
                    const typeLabel = act.order_type === 'table' ? `Mesa ${act.table_number || ''}` : (act.order_type === 'delivery' ? 'Delivery' : 'Mostrador');
                    return `
                        <tr class="hover:bg-slate-50">
                            <td class="p-2.5 font-mono text-slate-500">${timeStr}</td>
                            <td class="p-2.5 font-bold text-slate-800 flex items-center gap-1.5">
                                <i data-lucide="user" class="w-3.5 h-3.5 text-blue-500"></i>
                                <span>${act.cashier_name}</span>
                            </td>
                            <td class="p-2.5 uppercase text-[10px] font-bold text-slate-600">${typeLabel}</td>
                            <td class="p-2.5 text-slate-700 truncate max-w-xs" title="${itemsDesc}">${itemsDesc}</td>
                            <td class="p-2.5 text-slate-500">${methodNames[act.payment_method] || act.payment_method}</td>
                            <td class="p-2.5 text-right font-mono font-black text-slate-900">${formatMoney(act.total)}</td>
                        </tr>
                    `;
                }).join('');
            }
        }
        if (window.lucide) lucide.createIcons();
    } catch (e) {
        console.error('Error cargando monitoreo en vivo:', e);
    }
}

// ==================== ONLINE TUNNEL & PWA / APK ====================

let deferredPwaPrompt = null;
let currentTunnelData = null;

function initPwaAndOnline() {
    // Registrar Service Worker para PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('biencorrentino Service Worker registrado'))
            .catch(err => console.warn('Error registrando Service Worker:', err));
    }

    // Capturar evento de instalación nativa PWA
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPwaPrompt = e;
        const pwaBtn = document.getElementById('btn-install-pwa');
        if (pwaBtn) {
            pwaBtn.innerHTML = `
                <i data-lucide="plus-circle" class="w-4 h-4"></i>
                <span>Instalar biencorrentino en Android / PC</span>
            `;
            if (window.lucide) lucide.createIcons();
        }
    });

    window.addEventListener('appinstalled', () => {
        deferredPwaPrompt = null;
        showToast('¡biencorrentino instalada correctamente en tu dispositivo!', 'success');
    });

    // Verificar estado del túnel online al inicio y periódicamente
    checkTunnelStatus();
    setInterval(checkTunnelStatus, 30000);
}

async function checkTunnelStatus(manual = false) {
    try {
        const res = await fetch('/api/tunnel/info');
        const data = await res.json();
        currentTunnelData = data;

        const headerText = document.getElementById('header-online-text');
        const headerBadge = document.getElementById('header-online-badge');
        const modalStatus = document.getElementById('modal-tunnel-status-text');
        const urlInput = document.getElementById('online-url-input');

        if (data.online && data.url) {
            if (headerText) headerText.textContent = 'Online';
            if (headerBadge) {
                headerBadge.className = 'cursor-pointer flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-950/90 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/70 transition shadow-sm';
            }
            if (modalStatus) modalStatus.textContent = 'Túnel Online Activo y Seguro';
            if (urlInput) urlInput.value = data.url;

            // Renderizar QR Online si el canvas existe
            renderOnlineQr(data.url);

            if (manual) {
                showToast('Túnel conectado: ' + data.url, 'success');
            }
        } else {
            if (headerText) headerText.textContent = 'Local / Conectando';
            if (modalStatus) modalStatus.textContent = 'Iniciando túnel seguro...';
            if (urlInput) urlInput.value = 'Iniciando conexión pública...';
            if (manual) {
                showToast('Verificando conexión del túnel...', 'info');
            }
        }
        if (window.lucide) lucide.createIcons();
    } catch (e) {
        console.warn('No se pudo verificar el túnel online:', e);
    }
}

function renderOnlineQr(url) {
    const canvas = document.getElementById('online-qr-canvas');
    if (!canvas || !window.QRCode || !url) return;

    try {
        QRCode.toCanvas(canvas, url, {
            width: 180,
            margin: 1,
            color: {
                dark: '#0f172a',
                light: '#ffffff'
            }
        }, function (error) {
            if (error) console.error('Error generando QR Online:', error);
        });
    } catch (err) {
        console.error('Error al dibujar QR:', err);
    }
}

function openOnlineModal() {
    const modal = document.getElementById('modal-online');
    if (modal) {
        modal.classList.remove('hidden');
        checkTunnelStatus();
        if (currentTunnelData && currentTunnelData.url) {
            renderOnlineQr(currentTunnelData.url);
        }
        if (window.lucide) lucide.createIcons();
    }
}

function closeOnlineModal() {
    const modal = document.getElementById('modal-online');
    if (modal) modal.classList.add('hidden');
}

function copyOnlineUrl() {
    const input = document.getElementById('online-url-input');
    const msg = document.getElementById('copy-success-msg');
    if (!input || !input.value || input.value.startsWith('Iniciando')) {
        showToast('Enlace aún no disponible', 'warning');
        return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(input.value).then(() => {
            if (msg) {
                msg.classList.remove('hidden');
                setTimeout(() => msg.classList.add('hidden'), 3000);
            }
            showToast('¡Enlace copiado al portapapeles!', 'success');
        }).catch(() => fallbackCopy(input.value));
    } else {
        fallbackCopy(input.value);
    }
}

function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        showToast('¡Enlace copiado!', 'success');
    } catch (e) {
        showToast('Copia manual: ' + text, 'info');
    }
    document.body.removeChild(textarea);
}

function openMobileAppModal() {
    const modal = document.getElementById('modal-mobile-app');
    if (modal) {
        modal.classList.remove('hidden');
        if (window.lucide) lucide.createIcons();
    }
}

function closeMobileAppModal() {
    const modal = document.getElementById('modal-mobile-app');
    if (modal) modal.classList.add('hidden');
}

function toggleApkQr() {
    const container = document.getElementById('apk-qr-container');
    if (!container) return;

    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        const canvas = document.getElementById('apk-download-qr-canvas');
        if (canvas && window.QRCode) {
            const baseUrl = (currentTunnelData && currentTunnelData.url) ? currentTunnelData.url : window.location.origin;
            const apkUrl = `${baseUrl}/download/rsmarket.apk`;
            QRCode.toCanvas(canvas, apkUrl, {
                width: 170,
                margin: 1,
                color: {
                    dark: '#312e81',
                    light: '#ffffff'
                }
            }, function (error) {
                if (error) console.error('Error generando QR de APK:', error);
            });
        }
    } else {
        container.classList.add('hidden');
    }
}

async function triggerPwaInstall() {
    if (deferredPwaPrompt) {
        deferredPwaPrompt.prompt();
        const choiceResult = await deferredPwaPrompt.userChoice;
        if (choiceResult.outcome === 'accepted') {
            showToast('¡Instalando biencorrentino en tu dispositivo!', 'success');
            closeMobileAppModal();
        }
        deferredPwaPrompt = null;
    } else {
        // Instrucciones si ya está instalada o navegador no admite prompt directo
        alert('Para instalar en Android:\n1. Tocá el menú de los 3 puntos (⋮) de Google Chrome.\n2. Seleccioná "Instalar aplicación" o "Agregar a la pantalla principal".\n\n¡Listo! Tendrás el icono de biencorrentino en tu escritorio con acceso directo.');
    }
}

// ==================== MÓDULO INTEGRACIÓN MULTICANAL (PEDIDOSYA & RAPPI) ====================
let currentPosOrderChannel = 'local';

function openDeliveryChannelsModal() {
    const modal = document.getElementById('modal-delivery-channels');
    if (!modal) return;

    // Actualizar URLs de Webhook con el túnel actual o dominio
    const baseUrl = (currentTunnelData && currentTunnelData.url) ? currentTunnelData.url : window.location.origin;
    const pyUrlEl = document.getElementById('webhook-url-pedidosya');
    const rpUrlEl = document.getElementById('webhook-url-rappi');
    if (pyUrlEl) pyUrlEl.textContent = `${baseUrl}/api/integrations/webhook/pedidosya`;
    if (rpUrlEl) rpUrlEl.textContent = `${baseUrl}/api/integrations/webhook/rappi`;

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}

function closeDeliveryChannelsModal() {
    const modal = document.getElementById('modal-delivery-channels');
    if (modal) modal.classList.add('hidden');
}

function setPosOrderChannel(channel) {
    currentPosOrderChannel = channel;
    const badge = document.getElementById('pos-channel-badge');
    const extContainer = document.getElementById('pos-external-id-container');
    const btnLocal = document.getElementById('btn-chan-local');
    const btnPY = document.getElementById('btn-chan-pedidosya');
    const btnRP = document.getElementById('btn-chan-rappi');

    // Resetear estilos
    if (btnLocal) btnLocal.className = 'py-1 px-1 rounded-lg transition text-center text-slate-600 hover:text-slate-900';
    if (btnPY) btnPY.className = 'py-1 px-1 rounded-lg transition text-center text-slate-600 hover:text-red-600';
    if (btnRP) btnRP.className = 'py-1 px-1 rounded-lg transition text-center text-slate-600 hover:text-orange-600';

    if (channel === 'pedidosya') {
        if (btnPY) btnPY.className = 'py-1 px-1 rounded-lg transition text-center bg-red-600 text-white shadow-xs';
        if (badge) {
            badge.textContent = '🔴 PedidosYa';
            badge.className = 'text-[10px] font-bold px-1.5 py-0.2 rounded bg-red-100 text-red-700 uppercase';
        }
        if (extContainer) extContainer.classList.remove('hidden');
    } else if (channel === 'rappi') {
        if (btnRP) btnRP.className = 'py-1 px-1 rounded-lg transition text-center bg-orange-600 text-white shadow-xs';
        if (badge) {
            badge.textContent = '🟠 Rappi';
            badge.className = 'text-[10px] font-bold px-1.5 py-0.2 rounded bg-orange-100 text-orange-700 uppercase';
        }
        if (extContainer) extContainer.classList.remove('hidden');
    } else {
        if (btnLocal) btnLocal.className = 'py-1 px-1 rounded-lg transition text-center bg-white text-slate-800 shadow-xs';
        if (badge) {
            badge.textContent = 'Local';
            badge.className = 'text-[10px] font-bold px-1.5 py-0.2 rounded bg-slate-200 text-slate-700 uppercase';
        }
        if (extContainer) extContainer.classList.add('hidden');
    }
}

async function simulateChannelOrder(channel) {
    try {
        showToast(`⏳ Simulando pedido entrante de ${channel === 'pedidosya' ? 'PedidosYa' : 'Rappi'}...`, 'info', 2500);
        const res = await fetch('/api/integrations/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel: channel })
        });
        const data = await res.json();
        if (data.status === 'ok') {
            closeDeliveryChannelsModal();
            // Disparar sonido y actualización inmediata
            initStaffAudioAndNotifications();
            playOrderNotificationSound();
            showToast(`🔔 ¡Nuevo pedido de ${channel.toUpperCase()} #${data.order_id} recibido!`, 'success', 5000);
            
            // Refrescar cartelera y mostrar pedidos en proceso
            await fetchOrdersLiveStatus();
            navigateToOrdersStatus('process');
        } else {
            showToast(data.error || 'Error al simular pedido', 'error');
        }
    } catch (e) {
        console.error('Error simulando pedido:', e);
        showToast('Error de conexión con el simulador', 'error');
    }
}

function copyWebhookUrl(channel) {
    const el = document.getElementById(`webhook-url-${channel}`);
    if (el) {
        const text = el.textContent.trim();
        navigator.clipboard.writeText(text).then(() => {
            showToast(`✅ URL Webhook de ${channel.toUpperCase()} copiada al portapapeles`, 'success', 3000);
        }).catch(() => {
            prompt('Copiá esta URL:', text);
        });
    }
}



