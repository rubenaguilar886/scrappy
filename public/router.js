/* ══════════════════════════════════════════
   router.js — SPA sin recarga entre secciones del sidebar
   Mantiene en memoria el estado del Buscador (resultados, filtros)
   sin importar a qué sección se navegue.
══════════════════════════════════════════ */

(function () {
  const PATH_TO_SECTION = {
    "/": "buscador",
    "/settings": "mensajes",
    "/settings/crm": "crm",
    "/settings/plantillas": "plantillas",
    "/settings/integraciones": "integraciones",
  };

  // Inicializadores lazy — solo se disparan la primera vez que se abre
  // cada sección, para no pegarle al servidor al cargar la página.
  const sectionInitializers = {
    mensajes: () => window.initMensajesView && window.initMensajesView(),
    crm: () => window.initCrmView && window.initCrmView(),
  };
  const loadedSections = new Set();

  const sidebarEl = document.getElementById("app-sidebar");
  const toggleBtn = document.getElementById("sidebar-toggle");

  function activateSection(name) {
    if (!PATH_TO_SECTION_VALUES.includes(name)) name = "buscador";

    document.querySelectorAll(".app-section").forEach((s) => s.classList.remove("active"));
    const el = document.getElementById("section-" + name);
    if (el) el.classList.add("active");

    document.querySelectorAll(".sidebar-item[data-view]").forEach((a) => {
      a.classList.toggle("active", a.dataset.view === name);
    });

    syncMiNegocioButton(name);

    if (!loadedSections.has(name) && sectionInitializers[name]) {
      sectionInitializers[name]();
      loadedSections.add(name);
    }
  }

  // El botón "Mi negocio" solo tiene sentido dentro de Buscador, y ahí
  // solo cuando la vista interna activa es la de resultados (view-search) —
  // eso ya lo decide showView() en app.js; aquí solo lo ocultamos si el
  // usuario está en cualquier otra sección del sidebar.
  function syncMiNegocioButton(sectionName) {
    const btn = document.getElementById("btn-mi-negocio");
    if (!btn) return;
    if (sectionName !== "buscador") {
      btn.style.display = "none";
      return;
    }
    const innerActive = document.querySelector("#section-buscador .view.active");
    btn.style.display = innerActive && innerActive.id === "view-search" ? "block" : "none";
  }

  function navigateTo(path, opts) {
    const push = !opts || opts.push !== false;
    const name = PATH_TO_SECTION[path] || "buscador";
    activateSection(name);
    if (push) history.pushState({ path }, "", path);
  }

  const PATH_TO_SECTION_VALUES = Object.values(PATH_TO_SECTION);

  document.addEventListener("click", (e) => {
    const link = e.target.closest(".sidebar-item[data-path]");
    if (!link) return;
    e.preventDefault();
    navigateTo(link.dataset.path);
    collapseSidebar();
  });

  window.addEventListener("popstate", () => {
    navigateTo(location.pathname, { push: false });
  });

  function collapseSidebar() {
    sidebarEl?.classList.remove("expanded");
  }

  toggleBtn?.addEventListener("click", () => {
    sidebarEl?.classList.toggle("expanded");
  });

  document.addEventListener("click", (e) => {
    if (sidebarEl?.classList.contains("expanded") && !sidebarEl.contains(e.target)) {
      collapseSidebar();
    }
  });

  // Exponer para que app.js pueda re-sincronizar el botón Mi Negocio
  // cuando cambia la vista interna del Buscador (bd/mf/search).
  window.__syncMiNegocioButton = syncMiNegocioButton;

  navigateTo(location.pathname, { push: false });
})();
