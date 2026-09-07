// Constantes de almacenamiento
const STORAGE_CHAT_KEY_PREFIX = 'peertalkr_chat_history_';
const STORAGE_RECENT_KEY = 'peertalkr_recent_peers';

// Variables de Estado
let peer = null;
let activeConn = null;
let myPeerId = '';
let currentTargetId = '';
let selectedFile = null;

// Elementos DOM
const elements = {
    statusBadge: document.getElementById('statusBadge'),
    statusText: document.getElementById('statusText'),
    openSidebarBtn: document.getElementById('openSidebarBtn'),
    closeSidebarBtn: document.getElementById('closeSidebarBtn'),
    sidebar: document.getElementById('sidebar'),
    sidebarOverlay: document.getElementById('sidebarOverlay'),
    recentChatsList: document.getElementById('recentChatsList'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn'),

    connectionSection: document.getElementById('connectionSection'),
    chatSection: document.getElementById('chatSection'),

    myIdInput: document.getElementById('myIdInput'),
    copyIdBtn: document.getElementById('copyIdBtn'),
    connectForm: document.getElementById('connectForm'),
    remoteIdInput: document.getElementById('remoteIdInput'),

    chatTargetTitle: document.getElementById('chatTargetTitle'),
    chatConnectionState: document.getElementById('chatConnectionState'),
    reconnectBtn: document.getElementById('reconnectBtn'),
    disconnectBtn: document.getElementById('disconnectBtn'),
    backToConnectBtn: document.getElementById('backToConnectBtn'),
    messageList: document.getElementById('messageList'),
    
    chatForm: document.getElementById('chatForm'),
    messageInput: document.getElementById('messageInput'),
    attachBtn: document.getElementById('attachBtn'),
    fileInput: document.getElementById('fileInput'),
    filePreviewContainer: document.getElementById('filePreviewContainer'),
    fileNameDisplay: document.getElementById('fileNameDisplay'),
    fileSizeDisplay: document.getElementById('fileSizeDisplay'),
    removeFileBtn: document.getElementById('removeFileBtn'),

    // Modal
    modalOverlay: document.getElementById('customModal'),
    modalIcon: document.getElementById('modalIcon'),
    modalTitle: document.getElementById('modalTitle'),
    modalMessage: document.getElementById('modalMessage'),
    modalConfirmBtn: document.getElementById('modalConfirmBtn'),
    modalCancelBtn: document.getElementById('modalCancelBtn')
};

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    initPeer();
    setupEventListeners();
    renderRecentChatsList();
});

// Sistema de Modales Custom
function showCustomModal({ title = 'Aviso', message = '', icon = 'ℹ️', isConfirm = false }) {
    return new Promise((resolve) => {
        elements.modalTitle.textContent = title;
        elements.modalMessage.textContent = message;
        elements.modalIcon.textContent = icon;

        if (isConfirm) {
            elements.modalCancelBtn.classList.remove('hidden');
        } else {
            elements.modalCancelBtn.classList.add('hidden');
        }

        elements.modalOverlay.classList.remove('hidden');

        const onConfirm = () => {
            cleanup();
            resolve(true);
        };

        const onCancel = () => {
            cleanup();
            resolve(false);
        };

        const cleanup = () => {
            elements.modalOverlay.classList.add('hidden');
            elements.modalConfirmBtn.removeEventListener('click', onConfirm);
            elements.modalCancelBtn.removeEventListener('click', onCancel);
        };

        elements.modalConfirmBtn.addEventListener('click', onConfirm);
        elements.modalCancelBtn.addEventListener('click', onCancel);
    });
}

// Inicializar PeerJS
function initPeer() {
    updateStatus('connecting', 'Conectando...');
    
    const customId = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    peer = new Peer(customId, { debug: 1 });

    peer.on('open', (id) => {
        myPeerId = id;
        elements.myIdInput.value = id;
        updateStatus('ready', 'Listo');
    });

    peer.on('connection', (conn) => {
        setupIncomingConnection(conn);
    });

    peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        updateStatus('error', 'Error');
        addSystemMessage(`Error: ${err.type}`);
    });

    peer.on('disconnected', () => {
        updateStatus('error', 'Desconectado');
    });
}

// Controladores de eventos
function setupEventListeners() {
    elements.copyIdBtn.addEventListener('click', () => {
        if (!myPeerId) return;
        navigator.clipboard.writeText(myPeerId).then(() => {
            const originalText = elements.copyIdBtn.textContent;
            elements.copyIdBtn.textContent = '¡Copiado!';
            setTimeout(() => elements.copyIdBtn.textContent = originalText, 2000);
        });
    });

    elements.connectForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const targetId = elements.remoteIdInput.value.trim().toUpperCase();
        if (targetId) {
            connectToPeer(targetId);
        }
    });

    elements.disconnectBtn.addEventListener('click', () => {
        if (activeConn) {
            activeConn.close();
        }
        closeActiveChat();
    });

    elements.backToConnectBtn.addEventListener('click', () => {
        switchView('connection');
    });

    elements.reconnectBtn.addEventListener('click', () => {
        if (currentTargetId) {
            connectToPeer(currentTargetId);
        }
    });

    elements.chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleSendMessage();
    });

    elements.attachBtn.addEventListener('click', () => elements.fileInput.click());
    elements.fileInput.addEventListener('change', handleFileSelect);
    elements.removeFileBtn.addEventListener('click', clearSelectedFile);

    elements.openSidebarBtn.addEventListener('click', toggleSidebar);
    elements.closeSidebarBtn.addEventListener('click', toggleSidebar);
    elements.sidebarOverlay.addEventListener('click', toggleSidebar);
    elements.clearHistoryBtn.addEventListener('click', clearAllHistory);
}

// Conexión Peer
async function connectToPeer(targetId) {
    if (targetId === myPeerId) {
        await showCustomModal({
            title: 'Conexión no válida',
            message: 'No puedes conectarte a tu propio ID.',
            icon: '⚠️'
        });
        return;
    }

    updateStatus('connecting', 'Conectando...');
    
    const conn = peer.connect(targetId, { reliable: true });
    setupConnectionEvents(conn);
}

function setupIncomingConnection(conn) {
    if (activeConn) {
        conn.on('open', () => {
            conn.send({ type: 'system', text: 'El usuario se encuentra ocupado.' });
            setTimeout(() => conn.close(), 500);
        });
        return;
    }
    setupConnectionEvents(conn);
}

function setupConnectionEvents(conn) {
    conn.on('open', () => {
        activeConn = conn;
        currentTargetId = conn.peer;

        saveRecentPeer(currentTargetId);
        renderRecentChatsList();

        updateStatus('connected', 'Conectado');
        setChatHeaderState('online', 'En línea');

        elements.remoteIdInput.value = '';
        switchView('chat');
        loadChatHistory(currentTargetId);
        
        addSystemMessage(`Sesión iniciada con ${currentTargetId}`);
    });

    conn.on('data', (data) => {
        handleIncomingData(data);
    });

    conn.on('close', async () => {
        await showCustomModal({
            title: 'Sesión Finalizada',
            message: 'El usuario remoto ha cerrado la sesión.',
            icon: '🔌'
        });
        closeActiveChat();
    });

    conn.on('error', (err) => {
        console.error('Error de canal:', err);
        addSystemMessage('Error de datos.');
    });
}

// Enviar y Recibir
async function handleSendMessage() {
    const text = elements.messageInput.value.trim();
    if (!text && !selectedFile) return;

    if (!activeConn || !activeConn.open) {
        await showCustomModal({
            title: 'Sin Conexión',
            message: 'No hay una sesión activa para enviar este mensaje.',
            icon: '⚠️'
        });
        return;
    }

    const timestamp = new Date().toISOString();

    if (selectedFile) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const fileData = {
                type: 'file',
                file: e.target.result,
                fileName: selectedFile.name,
                fileType: selectedFile.type,
                fileSize: selectedFile.size,
                text: text,
                time: timestamp
            };

            activeConn.send(fileData);
            appendMessage({ ...fileData, isLocal: true }, true);
            saveMessageToStorage(currentTargetId, { ...fileData, isLocal: true });

            clearSelectedFile();
            elements.messageInput.value = '';
        };
        reader.readAsDataURL(selectedFile);
    } else {
        const msgData = {
            type: 'text',
            text: text,
            time: timestamp
        };

        activeConn.send(msgData);
        appendMessage({ ...msgData, isLocal: true }, true);
        saveMessageToStorage(currentTargetId, { ...msgData, isLocal: true });

        elements.messageInput.value = '';
    }
}

function handleIncomingData(data) {
    if (data.type === 'system') {
        addSystemMessage(data.text);
        return;
    }

    const msgObj = { ...data, isLocal: false };
    appendMessage(msgObj, true);
    saveMessageToStorage(currentTargetId, msgObj);
}

// Renderizado de Mensajes
function appendMessage(msg, animate = false) {
    const bubble = document.createElement('div');
    bubble.classList.add('message-bubble', msg.isLocal ? 'local' : 'remote');

    if (animate) {
        bubble.classList.add('message-send-anim');
    }

    const formattedTime = msg.time 
        ? new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
        : '';

    if (msg.type === 'file') {
        let fileContentHtml = '';
        
        if (!msg.file) {
            fileContentHtml = `
                <div class="file-download-box">
                    <div class="file-info-row">
                        <span class="file-icon">⚠️</span>
                        <span class="file-download-name">${escapeHtml(msg.fileName)}</span>
                    </div>
                    <span style="font-size:0.7rem; color: var(--text-muted);">Archivo excluido por tamaño.</span>
                </div>
            `;
        } else {
            if (msg.fileType && msg.fileType.startsWith('image/')) {
                fileContentHtml = `<img src="${msg.file}" class="image-preview" alt="Imagen">`;
            }

            fileContentHtml += `
                <div class="file-download-box">
                    <div class="file-info-row">
                        <span class="file-icon">📁</span>
                        <span class="file-download-name" title="${escapeHtml(msg.fileName)}">${escapeHtml(msg.fileName)}</span>
                    </div>
                    <a href="${msg.file}" download="${escapeHtml(msg.fileName)}" class="download-link-btn">Descargar (${formatBytes(msg.fileSize)})</a>
                </div>
            `;
        }

        if (msg.text) {
            fileContentHtml += `<div class="message-text" style="margin-top:0.4rem;">${escapeHtml(msg.text)}</div>`;
        }

        bubble.innerHTML = `
            ${fileContentHtml}
            <span class="message-time">${formattedTime}</span>
        `;
    } else {
        bubble.innerHTML = `
            <div class="message-text">${escapeHtml(msg.text)}</div>
            <span class="message-time">${formattedTime}</span>
        `;
    }

    elements.messageList.appendChild(bubble);
    scrollToBottom();
}

function addSystemMessage(text) {
    const sysMsg = document.createElement('div');
    sysMsg.classList.add('system-message', 'message-send-anim');
    sysMsg.textContent = text;
    elements.messageList.appendChild(sysMsg);
    scrollToBottom();
}

// Adjuntos
async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
        await showCustomModal({
            title: 'Archivo pesado',
            message: 'El archivo supera el límite permitido de 15MB.',
            icon: '📁'
        });
        elements.fileInput.value = '';
        return;
    }

    selectedFile = file;
    elements.fileNameDisplay.textContent = file.name;
    elements.fileSizeDisplay.textContent = formatBytes(file.size);
    elements.filePreviewContainer.classList.remove('hidden');
}

function clearSelectedFile() {
    selectedFile = null;
    elements.fileInput.value = '';
    elements.filePreviewContainer.classList.add('hidden');
}

// Almacenamiento
function saveMessageToStorage(peerId, msgObj) {
    const history = getStoredChatHistory(peerId);
    let messageToSave = { ...msgObj };

    if (messageToSave.type === 'file' && messageToSave.fileSize > 1.5 * 1024 * 1024) {
        messageToSave.file = null;
    }

    history.push(messageToSave);

    try {
        localStorage.setItem(STORAGE_CHAT_KEY_PREFIX + peerId, JSON.stringify(history));
    } catch (e) {
        console.warn('Almacenamiento lleno. Limpiando...', e);
        const cleanedHistory = history.map(item => {
            if (item.type === 'file') return { ...item, file: null };
            return item;
        });
        try {
            localStorage.setItem(STORAGE_CHAT_KEY_PREFIX + peerId, JSON.stringify(cleanedHistory));
        } catch (err) {
            console.error('Error al guardar datos:', err);
        }
    }
}

function getStoredChatHistory(peerId) {
    const data = localStorage.getItem(STORAGE_CHAT_KEY_PREFIX + peerId);
    return data ? JSON.parse(data) : [];
}

function loadChatHistory(peerId) {
    elements.messageList.innerHTML = '';
    const history = getStoredChatHistory(peerId);
    history.forEach(msg => appendMessage(msg, false));
}

function saveRecentPeer(peerId) {
    let recent = getRecentPeers();
    if (!recent.includes(peerId)) {
        recent.unshift(peerId);
        localStorage.setItem(STORAGE_RECENT_KEY, JSON.stringify(recent));
    }
}

function getRecentPeers() {
    const data = localStorage.getItem(STORAGE_RECENT_KEY);
    return data ? JSON.parse(data) : [];
}

function renderRecentChatsList() {
    const peers = getRecentPeers();
    elements.recentChatsList.innerHTML = '';

    if (peers.length === 0) {
        elements.recentChatsList.innerHTML = '<div class="empty-history">Sin chats guardados.</div>';
        return;
    }

    peers.forEach(peerId => {
        const item = document.createElement('div');
        item.classList.add('recent-chat-item');
        item.innerHTML = `
            <div>
                <div class="recent-chat-id">${peerId}</div>
                <div class="recent-chat-meta">PeerTalkr Chat</div>
            </div>
            <button class="icon-button small delete-chat-btn" title="Borrar">✕</button>
        `;

        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-chat-btn')) return;
            openSavedChat(peerId);
        });

        const deleteBtn = item.querySelector('.delete-chat-btn');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeChatHistory(peerId);
        });

        elements.recentChatsList.appendChild(item);
    });
}

function openSavedChat(peerId) {
    currentTargetId = peerId;
    switchView('chat');
    loadChatHistory(peerId);
    
    if (activeConn && activeConn.peer === peerId && activeConn.open) {
        setChatHeaderState('online', 'En línea');
    } else {
        setChatHeaderState('saved', 'Historial Local');
        addSystemMessage('Viendo historial.');
    }

    toggleSidebar();
}

function removeChatHistory(peerId) {
    localStorage.removeItem(STORAGE_CHAT_KEY_PREFIX + peerId);
    let recent = getRecentPeers().filter(id => id !== peerId);
    localStorage.setItem(STORAGE_RECENT_KEY, JSON.stringify(recent));
    renderRecentChatsList();

    if (currentTargetId === peerId) {
        closeActiveChat();
    }
}

async function clearAllHistory() {
    const confirmed = await showCustomModal({
        title: 'Borrar historial',
        message: '¿Estás seguro de que deseas eliminar todo el historial de conversaciones guardado localmente?',
        icon: '🗑️',
        isConfirm: true
    });

    if (!confirmed) return;
    
    const peers = getRecentPeers();
    peers.forEach(id => localStorage.removeItem(STORAGE_CHAT_KEY_PREFIX + id));
    localStorage.removeItem(STORAGE_RECENT_KEY);

    renderRecentChatsList();
    closeActiveChat();
}

// Helpers
function switchView(viewName) {
    if (viewName === 'connection') {
        elements.connectionSection.classList.remove('hidden');
        elements.chatSection.classList.add('hidden');
    } else if (viewName === 'chat') {
        elements.chatTargetTitle.textContent = currentTargetId;
        elements.connectionSection.classList.add('hidden');
        elements.chatSection.classList.remove('hidden');
    }
}

function closeActiveChat() {
    if (activeConn) {
        activeConn.close();
        activeConn = null;
    }
    currentTargetId = '';
    elements.messageList.innerHTML = '';
    switchView('connection');
    updateStatus('ready', 'Listo');
}

function updateStatus(state, text) {
    elements.statusBadge.className = `status-badge ${state}`;
    elements.statusText.textContent = text;
}

function setChatHeaderState(state, text) {
    elements.chatConnectionState.textContent = text;
    elements.chatConnectionState.className = `connection-state ${state}`;

    if (state === 'saved' || state === 'disconnected') {
        elements.reconnectBtn.classList.remove('hidden');
    } else {
        elements.reconnectBtn.classList.add('hidden');
    }
}

function toggleSidebar() {
    elements.sidebar.classList.toggle('hidden');
    elements.sidebarOverlay.classList.toggle('hidden');
}

function scrollToBottom() {
    elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

function formatBytes(bytes, decimals = 1) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
}
