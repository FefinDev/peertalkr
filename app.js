// ================================
// PEERTALKR - APP.JS
// ================================

let peer = null;
let conn = null;
let currentChatPeerId = null;
let myPeerId = null;

const MAX_FILE_SIZE = 10 * 1024 * 1024;

let peerInitializing = false;
let peerRetryTimer = null;
let peerTimeoutTimer = null;

let historyCache = null;
let historySaveTimer = null;
let recentChatsRenderTimer = null;

// ======================================================
// MODO LECTURA
// ======================================================

let readOnlyMode = true;

function setChatReadOnly(readOnly) {
    readOnlyMode = Boolean(readOnly);

    const input = document.getElementById("messageInput");
    const sendButton = document.getElementById("sendMessageBtn");
    const fileInput = document.getElementById("fileInput");
    const fileButton = document.getElementById("fileButton");
    const form = document.getElementById("messageForm");
    const modeBadge = document.getElementById("chatModeBadge");

    if (input) {
        input.disabled = readOnlyMode;
        input.readOnly = readOnlyMode;

        input.placeholder = readOnlyMode
            ? "Modo lectura: no puedes escribir"
            : "Escribe un mensaje...";
    }

    if (sendButton) {
        sendButton.disabled = readOnlyMode;
    }

    if (fileInput) {
        fileInput.disabled = readOnlyMode;

        // Limpiamos cualquier archivo que haya quedado seleccionado
        if (readOnlyMode) {
            fileInput.value = "";
        }
    }

    if (fileButton) {
        fileButton.disabled = readOnlyMode;
    }

    if (form) {
        form.classList.toggle("read-only", readOnlyMode);
    }

    if (modeBadge) {
        modeBadge.textContent = readOnlyMode
            ? "Solo lectura"
            : "En línea";

        modeBadge.classList.toggle("read-only", readOnlyMode);
        modeBadge.classList.toggle("online", !readOnlyMode);
    }
}

// ======================================================
// UTILIDADES
// ======================================================

function $(id) {
    return document.getElementById(id);
}

function initLucideIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
        window.lucide.createIcons();
    }
}

function showElement(element) {
    if (!element) return;
    element.classList.remove("hidden");
}

function hideElement(element) {
    if (!element) return;
    element.classList.add("hidden");
}

function updateStatus(type, text) {
    const statusBadge = $("statusBadge");
    const statusText = $("statusText");

    if (statusText) {
        statusText.textContent = text;
    }

    if (statusBadge) {
        statusBadge.className = "status-badge";
        statusBadge.classList.add(type);
    }
}

function showConnectionView() {
    showElement($("connectionView"));
    hideElement($("chatView"));
}

function showChatView() {
    hideElement($("connectionView"));
    showElement($("chatView"));
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// ======================================================
// INICIO
// ======================================================

document.addEventListener("DOMContentLoaded", () => {
    initLucideIcons();
    setupEventListeners();

    // Arranca SIEMPRE en modo lectura
    setChatReadOnly(true);

    renderRecentChats();

    // Dejamos que la interfaz pinte primero
    setTimeout(() => {
        initPeer();
    }, 100);
});

// ======================================================
// PEERJS
// ======================================================

function loadPeerJS() {
    return new Promise((resolve, reject) => {
        if (window.Peer) {
            resolve();
            return;
        }

        const existing = document.querySelector(
            'script[data-peertalkr-peerjs="true"]'
        );

        if (existing) {
            existing.addEventListener("load", resolve, { once: true });
            existing.addEventListener("error", reject, { once: true });
            return;
        }

        const script = document.createElement("script");

        script.src =
            "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";

        script.async = true;
        script.dataset.peertalkrPeerjs = "true";

        script.onload = () => {
            if (window.Peer) {
                resolve();
            } else {
                reject(new Error("PeerJS no está disponible."));
            }
        };

        script.onerror = () => {
            reject(new Error("No se pudo cargar PeerJS."));
        };

        document.head.appendChild(script);
    });
}

async function initPeer() {
    if (peerInitializing) {
        return;
    }

    peerInitializing = true;

    clearTimeout(peerTimeoutTimer);

    updateStatus("loading", "Inicializando...");

    const myIdElement = $("myPeerId");

    if (myIdElement) {
        myIdElement.textContent = "Generando ID...";
    }

    try {
        await loadPeerJS();

        destroyPeer();

        const shortId = generatePeerId();

        peer = new Peer(shortId, {
            host: "0.peerjs.com",
            port: 443,
            path: "/",
            secure: true,

            config: {
                iceServers: [
                    {
                        urls: "stun:stun.l.google.com:19302"
                    }
                ]
            }
        });

        attachPeerEvents();

        peerTimeoutTimer = setTimeout(() => {
            if (
                peer &&
                !peer.open &&
                peerInitializing
            ) {
                peerInitializing = false;

                updateStatus(
                    "error",
                    "El servidor tardó demasiado"
                );

                schedulePeerRetry(3000);
            }
        }, 15000);

    } catch (error) {
        console.error("Error iniciando PeerJS:", error);

        peerInitializing = false;

        updateStatus(
            "error",
            "No se pudo inicializar"
        );

        schedulePeerRetry(3000);
    }
}

function attachPeerEvents() {
    if (!peer) return;

    peer.on("open", (id) => {
        clearTimeout(peerTimeoutTimer);

        peerInitializing = false;
        myPeerId = id;

        const myIdElement = $("myPeerId");

        if (myIdElement) {
            myIdElement.textContent = id;
        }

        updateStatus("online", "Listo para conectar");

        const copyButton = $("copyIdBtn");

        if (copyButton) {
            copyButton.disabled = false;
        }

        const connectButton = $("connectBtn");

        if (connectButton) {
            connectButton.disabled = false;
        }
    });

    peer.on("connection", (incomingConnection) => {
        setupConnectionHandlers(incomingConnection);
    });

    peer.on("disconnected", () => {
        updateStatus(
            "warning",
            "Desconectado del servidor"
        );
    });

    peer.on("close", () => {
        updateStatus(
            "error",
            "Conexión cerrada"
        );

        setChatReadOnly(true);
    });

    peer.on("error", (error) => {
        console.error("PeerJS error:", error);

        peerInitializing = false;

        let message = "Error de conexión";

        if (error && error.type === "peer-unavailable") {
            message = "El peer no está disponible";
        }

        if (error && error.type === "network") {
            message = "Error de red";
        }

        updateStatus("error", message);

        setChatReadOnly(true);
    });
}

function generatePeerId() {
    return Math.random()
        .toString(36)
        .substring(2, 10)
        .toUpperCase();
}

function schedulePeerRetry(delay = 3000) {
    clearTimeout(peerRetryTimer);

    peerRetryTimer = setTimeout(() => {
        initPeer();
    }, delay);
}

function destroyPeer() {
    if (!peer) return;

    try {
        peer.removeAllListeners();
        peer.destroy();
    } catch (error) {
        console.warn("Error destruyendo peer:", error);
    }

    peer = null;
}

// ======================================================
// CONEXIONES
// ======================================================

function connectToPeer(remotePeerId) {
    if (!peer) {
        updateStatus(
            "error",
            "PeerJS todavía no está listo"
        );
        return;
    }

    remotePeerId = String(remotePeerId || "")
        .trim()
        .toUpperCase();

    if (!remotePeerId) {
        updateStatus(
            "error",
            "Introduce un ID"
        );
        return;
    }

    if (remotePeerId === myPeerId) {
        updateStatus(
            "error",
            "No puedes conectarte contigo mismo"
        );
        return;
    }

    if (conn) {
        try {
            conn.close();
        } catch (_) {}

        conn = null;
    }

    currentChatPeerId = remotePeerId;

    setChatReadOnly(true);

    updateStatus(
        "loading",
        "Conectando..."
    );

    const chatPeerId = $("chatPeerId");

    if (chatPeerId) {
        chatPeerId.textContent = remotePeerId;
    }

    showChatView();

    clearMessages();

    conn = peer.connect(
        remotePeerId,
        {
            reliable: true
        }
    );

    setupConnectionHandlers(conn);
}

function setupConnectionHandlers(connection) {
    if (!connection) return;

    conn = connection;
    currentChatPeerId = connection.peer;

    connection.on("open", () => {
        console.log(
            "Conectado con:",
            connection.peer
        );

        currentChatPeerId = connection.peer;

        const chatPeerId = $("chatPeerId");

        if (chatPeerId) {
            chatPeerId.textContent =
                currentChatPeerId;
        }

        updateStatus(
            "online",
            "Conectado"
        );

        // ================================
        // AQUÍ SE HABILITA LA ESCRITURA
        // ================================

        setChatReadOnly(false);

        hideElement($("offlineBanner"));

        loadChatHistory(currentChatPeerId);
    });

    connection.on("data", (data) => {
        handleIncomingData(data);
    });

    connection.on("close", () => {
        console.log("Conexión cerrada");

        setChatReadOnly(true);

        showElement($("offlineBanner"));

        updateStatus(
            "warning",
            "Chat desconectado"
        );
    });

    connection.on("error", (error) => {
        console.error(
            "Error en conexión:",
            error
        );

        setChatReadOnly(true);

        updateStatus(
            "error",
            "Error en la conexión"
        );
    });
}

function disconnectFromPeer() {
    if (conn) {
        try {
            conn.close();
        } catch (_) {}
    }

    conn = null;
    currentChatPeerId = null;

    // ================================
    // AL DESCONECTAR = SOLO LECTURA
    // ================================

    setChatReadOnly(true);

    showConnectionView();

    updateStatus(
        "online",
        peer && peer.open
            ? "Listo para conectar"
            : "Desconectado"
    );
}

// ======================================================
// ENVÍO DE MENSAJES
// ======================================================

function sendMessage() {

    // ==========================================
    // PROTECCIÓN ABSOLUTA DEL MODO LECTURA
    // ==========================================

    if (readOnlyMode) {
        console.warn(
            "Intento de enviar mensaje en modo lectura."
        );
        return false;
    }

    if (!conn || !conn.open) {
        console.warn(
            "No existe una conexión activa."
        );

        setChatReadOnly(true);

        return false;
    }

    const input = $("messageInput");

    if (!input) {
        return false;
    }

    const content = input.value.trim();

    if (!content) {
        return false;
    }

    const message = {
        type: "text",
        content: content,
        timestamp: Date.now()
    };

    try {
        conn.send(message);
    } catch (error) {
        console.error(
            "No se pudo enviar el mensaje:",
            error
        );

        setChatReadOnly(true);

        return false;
    }

    renderMessage(
        message,
        "outgoing"
    );

    saveMessage(
        currentChatPeerId,
        message,
        "outgoing"
    );

    input.value = "";

    return true;
}

// ======================================================
// ARCHIVOS
// ======================================================

function sendFile(file) {

    // ==========================================
    // PROTECCIÓN ABSOLUTA DEL MODO LECTURA
    // ==========================================

    if (readOnlyMode) {
        console.warn(
            "Intento de enviar archivo en modo lectura."
        );
        return false;
    }

    if (!conn || !conn.open) {
        setChatReadOnly(true);
        return false;
    }

    if (!file) {
        return false;
    }

    if (file.size > MAX_FILE_SIZE) {
        alert(
            "El archivo es demasiado grande. Máximo: 10 MB."
        );
        return false;
    }

    const reader = new FileReader();

    reader.onload = () => {

        // ==========================================
        // VOLVEMOS A COMPROBAR EL MODO LECTURA
        // ==========================================

        if (readOnlyMode) {
            console.warn(
                "El modo lectura se activó mientras se leía el archivo."
            );
            return;
        }

        if (!conn || !conn.open) {
            setChatReadOnly(true);
            return;
        }

        const fileMessage = {
            type: file.type.startsWith("image/")
                ? "image"
                : "file",

            name: file.name,
            size: file.size,
            mimeType: file.type,
            content: reader.result,
            timestamp: Date.now()
        };

        try {
            conn.send(fileMessage);
        } catch (error) {
            console.error(
                "No se pudo enviar el archivo:",
                error
            );

            setChatReadOnly(true);
            return;
        }

        renderMessage(
            fileMessage,
            "outgoing"
        );

        saveMessage(
            currentChatPeerId,
            fileMessage,
            "outgoing"
        );
    };

    reader.onerror = () => {
        alert(
            "No se pudo leer el archivo."
        );
    };

    reader.readAsDataURL(file);

    return true;
}

// ======================================================
// MENSAJES RECIBIDOS
// ======================================================

function handleIncomingData(data) {
    if (!data || typeof data !== "object") {
        return;
    }

    if (
        data.type !== "text" &&
        data.type !== "image" &&
        data.type !== "file"
    ) {
        return;
    }

    // RECIBIR SÍ está permitido en modo lectura
    renderMessage(
        data,
        "incoming"
    );

    saveMessage(
        currentChatPeerId,
        data,
        "incoming"
    );
}

// ======================================================
// RENDER DE MENSAJES
// ======================================================

function renderMessage(
    message,
    direction = "incoming",
    options = {}
) {
    const container =
        options.container ||
        $("messagesContainer");

    if (!container) {
        return;
    }

    const wrapper =
        document.createElement("div");

    wrapper.className =
        `message-wrapper ${direction}`;

    const bubble =
        document.createElement("div");

    bubble.className =
        "message-bubble";

    if (message.type === "text") {

        const text =
            document.createElement("div");

        text.className =
            "message-text";

        text.textContent =
            message.content || "";

        bubble.appendChild(text);

    } else if (
        message.type === "image"
    ) {

        const image =
            document.createElement("img");

        image.className =
            "message-image";

        image.src =
            message.content;

        image.alt =
            message.name || "Imagen";

        image.loading = "lazy";

        image.addEventListener(
            "click",
            () => {
                window.open(
                    message.content,
                    "_blank",
                    "noopener,noreferrer"
                );
            }
        );

        bubble.appendChild(image);

        if (message.name) {
            const name =
                document.createElement("div");

            name.className =
                "file-name";

            name.textContent =
                message.name;

            bubble.appendChild(name);
        }

    } else if (
        message.type === "file"
    ) {

        const fileBox =
            document.createElement("div");

        fileBox.className =
            "file-message";

        const fileName =
            document.createElement("div");

        fileName.className =
            "file-name";

        fileName.textContent =
            message.name || "Archivo";

        const download =
            document.createElement("a");

        download.className =
            "file-download";

        download.href =
            message.content;

        download.download =
            message.name || "archivo";

        download.textContent =
            "Abrir / descargar";

        download.target = "_blank";
        download.rel =
            "noopener noreferrer";

        fileBox.appendChild(fileName);
        fileBox.appendChild(download);

        bubble.appendChild(fileBox);
    }

    const time =
        document.createElement("div");

    time.className =
        "message-time";

    time.textContent =
        formatTime(message.timestamp);

    bubble.appendChild(time);

    wrapper.appendChild(bubble);

    container.appendChild(wrapper);

    if (!options.skipScroll) {
        container.scrollTop =
            container.scrollHeight;
    }

    if (!options.skipIcons) {
        initLucideIcons();
    }
}

function formatTime(timestamp) {
    if (!timestamp) {
        return "";
    }

    return new Date(timestamp)
        .toLocaleTimeString(
            [],
            {
                hour: "2-digit",
                minute: "2-digit"
            }
        );
}

function clearMessages() {
    const container =
        $("messagesContainer");

    if (!container) {
        return;
    }

    container.innerHTML = "";
}

// ======================================================
// HISTORIAL
// ======================================================

function getHistory() {
    if (historyCache !== null) {
        return historyCache;
    }

    try {
        historyCache =
            JSON.parse(
                localStorage.getItem(
                    "peertalkr_history"
                ) || "{}"
            );
    } catch (error) {
        console.error(
            "Error leyendo historial:",
            error
        );

        historyCache = {};
    }

    return historyCache;
}

function persistHistory() {
    clearTimeout(historySaveTimer);

    historySaveTimer =
        setTimeout(() => {
            try {
                localStorage.setItem(
                    "peertalkr_history",
                    JSON.stringify(
                        getHistory()
                    )
                );
            } catch (error) {
                console.error(
                    "No se pudo guardar el historial:",
                    error
                );
            }
        }, 300);
}

function saveMessage(
    peerId,
    message,
    direction
) {
    if (!peerId) {
        return;
    }

    const history = getHistory();

    if (!history[peerId]) {
        history[peerId] = [];
    }

    history[peerId].push({
        ...message,
        direction
    });

    // Evitamos historiales gigantes
    if (history[peerId].length > 500) {
        history[peerId] =
            history[peerId].slice(-500);
    }

    persistHistory();

    renderRecentChats();
}

function loadChatHistory(peerId) {
    const history =
        getHistory();

    const messages =
        history[peerId] || [];

    clearMessages();

    if (!messages.length) {
        showWelcomeMessage();
        return;
    }

    const fragment =
        document.createDocumentFragment();

    const temporaryContainer =
        document.createElement("div");

    temporaryContainer.style.display =
        "contents";

    fragment.appendChild(
        temporaryContainer
    );

    for (const message of messages) {
        renderMessage(
            message,
            message.direction || "incoming",
            {
                container:
                    temporaryContainer,
                skipScroll: true,
                skipIcons: true
            }
        );
    }

    const container =
        $("messagesContainer");

    if (container) {
        container.appendChild(fragment);
        container.scrollTop =
            container.scrollHeight;
    }

    initLucideIcons();
}

function showWelcomeMessage() {
    const container =
        $("messagesContainer");

    if (!container) {
        return;
    }

    const welcome =
        document.createElement("div");

    welcome.className =
        "chat-welcome";

    welcome.innerHTML = `
        <div class="chat-welcome-icon">
            <i data-lucide="message-circle"></i>
        </div>
        <h3>Sin mensajes todavía</h3>
        <p>Los mensajes de esta conversación aparecerán aquí.</p>
    `;

    container.appendChild(welcome);

    initLucideIcons();
}

// ======================================================
// CHATS RECIENTES
// ======================================================

function renderRecentChats() {
    clearTimeout(
        recentChatsRenderTimer
    );

    recentChatsRenderTimer =
        setTimeout(() => {

            const container =
                $("recentChats");

            if (!container) {
                return;
            }

            const history =
                getHistory();

            container.innerHTML = "";

            const peerIds =
                Object.keys(history);

            if (!peerIds.length) {

                const empty =
                    document.createElement("div");

                empty.className =
                    "recent-empty";

                empty.textContent =
                    "No hay chats recientes.";

                container.appendChild(empty);

                return;
            }

            peerIds
                .sort((a, b) => {
                    const aMessages =
                        history[a] || [];

                    const bMessages =
                        history[b] || [];

                    const aLast =
                        aMessages.length
                            ? aMessages[
                                aMessages.length - 1
                            ].timestamp || 0
                            : 0;

                    const bLast =
                        bMessages.length
                            ? bMessages[
                                bMessages.length - 1
                            ].timestamp || 0
                            : 0;

                    return bLast - aLast;
                })
                .forEach((peerId) => {

                    const messages =
                        history[peerId] || [];

                    const last =
                        messages[
                            messages.length - 1
                        ];

                    const item =
                        document.createElement("button");

                    item.type = "button";
                    item.className =
                        "recent-chat";

                    item.dataset.peerId =
                        peerId;

                    const icon =
                        document.createElement("div");

                    icon.className =
                        "recent-chat-icon";

                    icon.innerHTML =
                        '<i data-lucide="message-circle"></i>';

                    const info =
                        document.createElement("div");

                    info.className =
                        "recent-chat-info";

                    const title =
                        document.createElement("div");

                    title.className =
                        "recent-chat-title";

                    title.textContent =
                        peerId;

                    const preview =
                        document.createElement("div");

                    preview.className =
                        "recent-chat-preview";

                    if (last) {
                        if (last.type === "text") {
                            preview.textContent =
                                last.content;
                        } else if (
                            last.type === "image"
                        ) {
                            preview.textContent =
                                "📷 Imagen";
                        } else {
                            preview.textContent =
                                "📎 Archivo";
                        }
                    }

                    info.appendChild(title);
                    info.appendChild(preview);

                    item.appendChild(icon);
                    item.appendChild(info);

                    item.addEventListener(
                        "click",
                        () => {
                            openHistoryChat(
                                peerId
                            );
                        }
                    );

                    container.appendChild(item);
                });

            initLucideIcons();

        }, 100);
}

function openHistoryChat(peerId) {
    currentChatPeerId = peerId;

    const chatPeerId =
        $("chatPeerId");

    if (chatPeerId) {
        chatPeerId.textContent =
            peerId;
    }

    // ==========================================
    // HISTORIAL = SIEMPRE SOLO LECTURA
    // ==========================================

    setChatReadOnly(true);

    showElement(
        $("offlineBanner")
    );

    updateStatus(
        "warning",
        "Modo lectura"
    );

    showChatView();

    loadChatHistory(peerId);

    closeSidebar();
}

// ======================================================
// EVENTOS
// ======================================================

function setupEventListeners() {

    // ------------------------------------------
    // FORMULARIO DE MENSAJE
    // ------------------------------------------

    const messageForm =
        $("messageForm");

    if (messageForm) {

        messageForm.addEventListener(
            "submit",
            (event) => {

                event.preventDefault();

                // SEGURIDAD EXTRA
                if (readOnlyMode) {
                    return;
                }

                sendMessage();
            }
        );
    }

    // ------------------------------------------
    // INPUT
    // ------------------------------------------

    const messageInput =
        $("messageInput");

    if (messageInput) {

        messageInput.addEventListener(
            "keydown",
            (event) => {

                if (readOnlyMode) {
                    event.preventDefault();
                    return;
                }

                if (
                    event.key === "Enter" &&
                    !event.shiftKey
                ) {
                    event.preventDefault();

                    sendMessage();
                }
            }
        );

        messageInput.addEventListener(
            "paste",
            (event) => {

                if (readOnlyMode) {
                    event.preventDefault();
                }
            }
        );
    }

    // ------------------------------------------
    // CONECTAR
    // ------------------------------------------

    const connectButton =
        $("connectBtn");

    if (connectButton) {

        connectButton.addEventListener(
            "click",
            () => {

                const input =
                    $("remotePeerId");

                if (!input) {
                    return;
                }

                connectToPeer(
                    input.value
                );
            }
        );
    }

    const remoteInput =
        $("remotePeerId");

    if (remoteInput) {

        remoteInput.addEventListener(
            "keydown",
            (event) => {

                if (
                    event.key === "Enter"
                ) {
                    event.preventDefault();

                    connectToPeer(
                        remoteInput.value
                    );
                }
            }
        );
    }

    // ------------------------------------------
    // COPIAR ID
    // ------------------------------------------

    const copyButton =
        $("copyIdBtn");

    if (copyButton) {

        copyButton.addEventListener(
            "click",
            async () => {

                if (!myPeerId) {
                    return;
                }

                try {

                    await navigator.clipboard.writeText(
                        myPeerId
                    );

                    const oldText =
                        copyButton.innerHTML;

                    copyButton.innerHTML =
                        '<i data-lucide="check"></i> Copiado';

                    initLucideIcons();

                    setTimeout(() => {
                        copyButton.innerHTML =
                            oldText;

                        initLucideIcons();
                    }, 1500);

                } catch (error) {
                    console.error(
                        "No se pudo copiar:",
                        error
                    );
                }
            }
        );
    }

    // ------------------------------------------
    // ARCHIVOS
    // ------------------------------------------

    const fileButton =
        $("fileButton");

    const fileInput =
        $("fileInput");

    if (fileButton && fileInput) {

        fileButton.addEventListener(
            "click",
            (event) => {

                if (readOnlyMode) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }

                fileInput.click();
            }
        );

        fileInput.addEventListener(
            "change",
            (event) => {

                if (readOnlyMode) {
                    event.target.value = "";
                    return;
                }

                const file =
                    event.target.files &&
                    event.target.files[0];

                if (file) {
                    sendFile(file);
                }

                event.target.value = "";
            }
        );
    }

    // ------------------------------------------
    // SIDEBAR
    // ------------------------------------------

    const sidebarOpenButton =
        $("sidebarOpenBtn");

    const sidebarCloseButton =
        $("sidebarCloseBtn");

    if (sidebarOpenButton) {
        sidebarOpenButton.addEventListener(
            "click",
            openSidebar
        );
    }

    if (sidebarCloseButton) {
        sidebarCloseButton.addEventListener(
            "click",
            closeSidebar
        );
    }

    // ------------------------------------------
    // VOLVER
    // ------------------------------------------

    const backButton =
        $("backBtn");

    if (backButton) {

        backButton.addEventListener(
            "click",
            () => {

                setChatReadOnly(true);

                showConnectionView();

                currentChatPeerId = null;

                if (conn) {
                    try {
                        conn.close();
                    } catch (_) {}
                }

                conn = null;
            }
        );
    }

    // ------------------------------------------
    // DESCONECTAR
    // ------------------------------------------

    const disconnectButton =
        $("disconnectBtn");

    if (disconnectButton) {

        disconnectButton.addEventListener(
            "click",
            disconnectFromPeer
        );
    }

    // ------------------------------------------
    // LIMPIAR CHAT ACTUAL
    // ------------------------------------------

    const clearCurrentButton =
        $("clearCurrentChatBtn");

    if (clearCurrentButton) {

        clearCurrentButton.addEventListener(
            "click",
            () => {

                if (!currentChatPeerId) {
                    return;
                }

                const confirmed =
                    confirm(
                        "¿Querés borrar este chat del historial?"
                    );

                if (!confirmed) {
                    return;
                }

                const history =
                    getHistory();

                delete history[
                    currentChatPeerId
                ];

                persistHistory();

                clearMessages();

                showWelcomeMessage();

                renderRecentChats();
            }
        );
    }

    // ------------------------------------------
    // LIMPIAR TODO EL HISTORIAL
    // ------------------------------------------

    const clearHistoryButton =
        $("clearHistoryBtn");

    if (clearHistoryButton) {

        clearHistoryButton.addEventListener(
            "click",
            () => {

                const confirmed =
                    confirm(
                        "¿Querés borrar todo el historial?"
                    );

                if (!confirmed) {
                    return;
                }

                historyCache = {};

                localStorage.removeItem(
                    "peertalkr_history"
                );

                renderRecentChats();

                if (currentChatPeerId) {
                    clearMessages();
                    showWelcomeMessage();
                }
            }
        );
    }

    // ------------------------------------------
    // CERRAR SIDEBAR HACIENDO CLICK AFUERA
    // ------------------------------------------

    const sidebarOverlay =
        $("sidebarOverlay");

    if (sidebarOverlay) {

        sidebarOverlay.addEventListener(
            "click",
            closeSidebar
        );
    }

    // ------------------------------------------
    // DRAG & DROP
    // ------------------------------------------

    const messageArea =
        $("messagesContainer");

    if (messageArea) {

        messageArea.addEventListener(
            "dragover",
            (event) => {
                event.preventDefault();
            }
        );

        messageArea.addEventListener(
            "drop",
            (event) => {

                event.preventDefault();

                // =================================
                // NUNCA aceptar archivos en lectura
                // =================================

                if (readOnlyMode) {
                    return;
                }

                const files =
                    event.dataTransfer.files;

                if (
                    files &&
                    files.length > 0
                ) {
                    sendFile(files[0]);
                }
            }
        );
    }
}

// ======================================================
// SIDEBAR
// ======================================================

function openSidebar() {
    const sidebar =
        $("sidebar");

    const overlay =
        $("sidebarOverlay");

    if (sidebar) {
        sidebar.classList.add("open");
    }

    if (overlay) {
        overlay.classList.add("open");
    }
}

function closeSidebar() {
    const sidebar =
        $("sidebar");

    const overlay =
        $("sidebarOverlay");

    if (sidebar) {
        sidebar.classList.remove("open");
    }

    if (overlay) {
        overlay.classList.remove("open");
    }
}

// ======================================================
// PAGEHIDE
// ======================================================

window.addEventListener(
    "pagehide",
    () => {

        clearTimeout(
            historySaveTimer
        );

        try {
            if (historyCache !== null) {
                localStorage.setItem(
                    "peertalkr_history",
                    JSON.stringify(
                        historyCache
                    )
                );
            }
        } catch (error) {
            console.error(
                "No se pudo guardar historial:",
                error
            );
        }
    }
);