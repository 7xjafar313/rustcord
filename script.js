document.addEventListener('DOMContentLoaded', () => {
    // --- Global State ---
    let myUsername = '';
    let isAdmin = false;
    let currentUser = JSON.parse(localStorage.getItem('rust_cord_user')) || null;
    let currentServer = 'rust-main';
    let currentChannel = 'general';
    let loadedMessages = new Set();
    let replyingToId = null;
    let typingUsers = new Set();
    let isCameraOn = false, isScreenSharing = false;
    let localStream = null, peer = null, currentCall = null;
    const audioContexts = {};

    // --- Elements ---
    const authScreen = document.getElementById('auth-screen'), mainApp = document.getElementById('main-app');
    const input = document.getElementById('chat-input'), messagesContainer = document.querySelector('.messages-container');
    const settingsModal = document.getElementById('settings-modal'), settingsForm = document.getElementById('settings-form');
    const gifPicker = document.getElementById('gif-picker'), gifResults = document.getElementById('gif-results');
    const pinnedSidebar = document.getElementById('pinned-sidebar'), pinnedList = document.getElementById('pinned-messages-list');
    const voicePanel = document.getElementById('voice-panel'), videoGrid = document.getElementById('video-grid');

    const GIPHY_KEY = 'dc6zaTOxFJmzC'; // Public Beta Key

    // --- Initialization ---
    if (currentUser) loginUser(currentUser);
    else authScreen.style.display = 'flex';

    function loginUser(user) {
        localStorage.setItem('rust_cord_user', JSON.stringify(user));
        myUsername = user.username;
        isAdmin = getRoleClass(myUsername) === 'role-owner' || getRoleClass(myUsername) === 'role-admin';
        document.querySelector('.username').innerText = user.fullname || user.username;
        document.querySelector('.user-tag').innerText = `@${user.username}`;
        if (user.avatar) document.querySelector('.user-info img').src = user.avatar;

        applyTheme(user.theme || 'dark-rust');

        authScreen.style.display = 'none';
        mainApp.style.display = 'flex';
        initServers();
        fetchUsers();
    }

    function applyTheme(theme) {
        document.body.setAttribute('data-theme', theme);
    }

    // --- Auth & Profile ---
    const authSwitchLink = document.getElementById('auth-switch-link');
    let isLoginMode = true;
    authSwitchLink.onclick = (e) => {
        e.preventDefault();
        isLoginMode = !isLoginMode;
        document.getElementById('auth-title').innerText = isLoginMode ? 'مرحباً بعودتك!' : 'إنشاء حساب';
        document.getElementById('auth-submit').innerText = isLoginMode ? 'تسجيل الدخول' : 'إنشاء حساب';
        ['name-group', 'username-group', 'bio-group', 'avatar-group'].forEach(id => document.getElementById(id).style.display = isLoginMode ? 'none' : 'block');
    };

    document.getElementById('auth-form').onsubmit = (e) => {
        e.preventDefault();
        const users = JSON.parse(localStorage.getItem('rust_cord_users')) || [];
        if (isLoginMode) {
            const user = users.find(u => (u.email === document.getElementById('auth-email').value || u.username === document.getElementById('auth-email').value) && u.pass === document.getElementById('auth-pass').value);
            if (user) loginUser(user); else alert('خطأ في البيانات!');
        } else {
            const newUser = {
                email: document.getElementById('auth-email').value,
                pass: document.getElementById('auth-pass').value,
                username: document.getElementById('auth-username').value,
                fullname: document.getElementById('auth-fullname').value,
                bio: document.getElementById('auth-bio').value,
                avatar: document.getElementById('auth-avatar').value,
                theme: 'dark-rust', status: 'online'
            };
            users.push(newUser);
            localStorage.setItem('rust_cord_users', JSON.stringify(users));
            loginUser(newUser);
        }
    };

    // --- Music Bot Logic ---
    const musicPlayerBar = document.getElementById('music-player-bar');
    const musicTitle = document.getElementById('music-title');
    const ytContainer = document.getElementById('yt-player-container');

    async function handleMusicCommand(text) {
        if (text.startsWith('#شغل ')) {
            const query = text.replace('#شغل ', '').trim();
            if (query.startsWith('@')) {
                await sendMessageToTelegram(`[SYSTEM]:MUSIC_PLAY_TG|${query}`);
            } else {
                await sendMessageToTelegram(`[SYSTEM]:MUSIC_PLAY|${query}`);
            }
            return true;
        } else if (text === '#ايقاف') {
            await sendMessageToTelegram(`[SYSTEM]:MUSIC_STOP`);
            return true;
        }
        return false;
    }

    async function playMusicSync(query, isTg = false) {
        musicPlayerBar.style.display = 'flex';
        musicTitle.innerText = `جاري تشغيل: ${query}`;

        if (isTg) {
            // Logic to fetch from Telegram via BOT_TOKEN getUpdates or similar
            // Since we can't reliably get history without a UserBot, 
            // we will search for any audio files the bot has seen recently in its updates
            try {
                const botToken = '6780979570:AAEpS358Uxk_FuegiXu80-ElfxnVFE_AQrU';
                const res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
                const data = await res.json();

                // Filter updates for audio files from the specified channel username if possible
                // Or just the latest audio files the bot has received
                let audioFiles = data.result
                    .filter(u => u.message && u.message.audio)
                    .map(u => ({ id: u.message.audio.file_id, name: u.message.audio.title || 'صوت من تيليجرام' }));

                if (audioFiles.length > 0) {
                    const audio = audioFiles[0]; // Play the latest one
                    musicTitle.innerText = `تشغيل من تيليجرام: ${audio.name}`;
                    ytContainer.innerHTML = `<audio controls autoplay src="/api/tg-audio/${audio.id}" style="width:100%; height:30px;"></audio>`;
                } else {
                    musicTitle.innerText = `⚠️ لم يتم العثور على صوتيات في @${query.replace('@', '')}`;
                    setTimeout(stopMusicSync, 3000);
                }
            } catch (e) { console.error(e); stopMusicSync(); }
        } else {
            ytContainer.innerHTML = `<iframe width="200" height="112" src="https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(query)}&autoplay=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
        }
    }

    function stopMusicSync() {
        musicPlayerBar.style.display = 'none';
        ytContainer.innerHTML = '';
    }

    document.getElementById('music-stop').onclick = () => {
        sendMessageToTelegram(`[SYSTEM]:MUSIC_STOP`);
    };

    document.querySelector('.user-info').onclick = () => {
        document.getElementById('settings-fullname').value = currentUser.fullname || '';
        document.getElementById('settings-bio').value = currentUser.bio || '';
        document.getElementById('settings-avatar').value = currentUser.avatar || '';
        document.getElementById('settings-status').value = currentUser.status || 'online';
        document.getElementById('settings-theme').value = currentUser.theme || 'dark-rust';
        settingsModal.style.display = 'flex';
    };

    settingsForm.onsubmit = async (e) => {
        e.preventDefault();
        const users = JSON.parse(localStorage.getItem('rust_cord_users')) || [];
        const idx = users.findIndex(u => u.username === myUsername);
        if (idx !== -1) {
            currentUser.fullname = document.getElementById('settings-fullname').value;
            currentUser.bio = document.getElementById('settings-bio').value;
            currentUser.avatar = document.getElementById('settings-avatar').value;
            currentUser.status = document.getElementById('settings-status').value;
            currentUser.theme = document.getElementById('settings-theme').value;
            currentUser.customStatus = document.getElementById('settings-custom-status').value;

            users[idx] = currentUser;
            localStorage.setItem('rust_cord_users', JSON.stringify(users));
            localStorage.setItem('rust_cord_user', JSON.stringify(currentUser));

            applyTheme(currentUser.theme);
            loginUser(currentUser);
            settingsModal.style.display = 'none';
            await sendHeartbeat();
        }
    };

    document.getElementById('logout-btn').onclick = () => { localStorage.removeItem('rust_cord_user'); location.reload(); };
    document.getElementById('close-settings').onclick = () => settingsModal.style.display = 'none';
    document.getElementById('cancel-settings').onclick = () => settingsModal.style.display = 'none';

    // --- Messaging Core ---
    async function sendMessage(text, imageUrl = null, fileData = null, fileName = null) {
        try {
            // Check for music commands
            const isMusic = await handleMusicCommand(text);
            if (isMusic) return;

            await fetch('/api/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ author: myUsername, text, imageUrl, replyTo: replyingToId, fileData, fileName })
            });
            cancelReply();
        } catch (e) { console.error(e); }
    }

    async function fetchMessagesFromServer() {
        try {
            const res = await fetch('/api/messages');
            const msgs = await res.json();
            const pinned = msgs.filter(m => m.pinned);
            updatePinnedUI(pinned);

            msgs.forEach(msg => {
                if (!loadedMessages.has(msg.id)) {
                    loadedMessages.add(msg.id);
                    if (msg.text.startsWith('[SYSTEM]:')) handleSystemMessage(msg.text);
                    else addMessage(msg.author, msg.text, msg.author === myUsername, msg.imageUrl, msg.id, msg.replyTo, msg.reactions, msg.pinned, msg.fileName, msg.fileData);
                } else {
                    updateMessageUI(msg);
                }
            });
        } catch (e) { }
    }

    function addMessage(author, text, isUser, img, id, replyId, reactions = {}, isPinned = false, fileName = null, fileData = null) {
        const div = document.createElement('div');
        div.className = `message ${isPinned ? 'pinned-msg' : ''}`;
        div.id = `msg-${id}`;

        const roleClass = getRoleClass(author);
        const avatar = (author === myUsername && currentUser.avatar) ? currentUser.avatar : `https://ui-avatars.com/api/?name=${author}&background=random`;

        let content = `<div class="message-text">${parseMarkdown(text)}</div>`;
        if (img) content += `<img src="${img}" class="chat-img" onclick="window.open('${img}')">`;
        if (fileData) content += `<div class="file-share"><i class="fas fa-file"></i> <a href="${fileData}" download="${fileName}">${fileName}</a></div>`;

        // Reactions
        let reactHtml = '<div class="reactions-container">';
        for (const [emoji, users] of Object.entries(reactions)) {
            reactHtml += `<div class="reaction-chip ${users.includes(myUsername) ? 'active' : ''}" onclick="window.toggleReaction('${id}', '${emoji}')">${emoji} <span class="count">${users.length}</span></div>`;
        }
        reactHtml += '</div>';

        div.innerHTML = `
            <div class="message-avatar"><img src="${avatar}"></div>
            <div class="message-content">
                <div class="message-header">
                    ${getRoleBadge(author)}
                    <span class="message-author ${roleClass}">${author}</span>
                    <span class="message-timestamp">${new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}</span>
                    ${isPinned ? '<i class="fas fa-thumbtack pin-indicator"></i>' : ''}
                </div>
                ${content}
                ${reactHtml}
            </div>
            <div class="message-actions">
                <i class="fas fa-smile" onclick="window.showEmojiPick('${id}')" title="تفاعل"></i>
                <i class="fas fa-reply" onclick="window.prepReply('${id}', '${author}', '${text.replace(/'/g, "\\'")}')" title="رد"></i>
                <i class="fas fa-thumbtack" onclick="window.togglePin('${id}', ${!isPinned})" title="${isPinned ? 'إلغاء التثبيت' : 'تثبيت'}"></i>
                ${(author === myUsername || isAdmin) ? `<i class="fas fa-edit" onclick="window.editMessage('${id}', '${text.replace(/'/g, "\\'")}')"></i>` : ''}
                ${(author === myUsername || isAdmin) ? `<i class="fas fa-trash" onclick="window.deleteMessage('${id}')"></i>` : ''}
            </div>
        `;
        messagesContainer.appendChild(div);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        if (!isUser) playNotif();
    }

    function updateMessageUI(msg) {
        const el = document.getElementById(`msg-${msg.id}`);
        if (!el) return;
        // Simple update for reactions and pin status
        const reactContainer = el.querySelector('.reactions-container');
        if (reactContainer) {
            let reactHtml = '';
            for (const [emoji, users] of Object.entries(msg.reactions || {})) {
                reactHtml += `<div class="reaction-chip ${users.includes(myUsername) ? 'active' : ''}" onclick="window.toggleReaction('${msg.id}', '${emoji}')">${emoji} <span class="count">${users.length}</span></div>`;
            }
            reactContainer.innerHTML = reactHtml;
        }
        const pinAction = el.querySelector('.fa-thumbtack');
        if (pinAction) pinAction.onclick = () => window.togglePin(msg.id, !msg.pinned);
    }

    // --- Message Actions Helpers ---
    window.toggleReaction = async (id, emoji) => {
        await fetch(`/api/messages/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reaction: emoji, username: myUsername }) });
        fetchMessagesFromServer();
    };

    window.togglePin = async (id, status) => {
        await fetch(`/api/messages/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: status }) });
        fetchMessagesFromServer();
    };

    window.showEmojiPick = (id) => {
        const emoji = prompt('أدخل إيموجي للتفاعل:', '👍');
        if (emoji) window.toggleReaction(id, emoji);
    };

    window.prepReply = (id, auth, txt) => {
        replyingToId = id;
        document.getElementById('replying-to-text').innerText = `الرد على ${auth}: ${txt}`;
        document.getElementById('reply-preview').style.display = 'flex';
        input.focus();
    };
    function cancelReply() { replyingToId = null; document.getElementById('reply-preview').style.display = 'none'; }
    document.getElementById('cancel-reply').onclick = cancelReply;

    window.editMessage = async (id, old) => {
        const txt = prompt('تعديل:', old);
        if (txt && txt !== old) { await fetch(`/api/messages/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: txt }) }); location.reload(); }
    };

    window.deleteMessage = async (id) => { if (confirm('حذف؟')) { await fetch(`/api/messages/${id}`, { method: 'DELETE' }); location.reload(); } };

    function parseMarkdown(text) { return text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/`(.*?)`/g, '<code>$1</code>'); }
    function getRoleClass(u) { return (u === 'sww' || u.includes('المطور')) ? 'role-owner' : (u.toLowerCase().includes('admin') ? 'role-admin' : 'role-member'); }
    function getRoleBadge(u) { const c = getRoleClass(u); return c === 'role-owner' ? '<span class="role-badge badge-owner">المطور</span>' : (c === 'role-admin' ? '<span class="role-badge badge-admin">إدارة</span>' : ''); }

    // --- GIF Picker ---
    document.getElementById('gif-btn').onclick = () => { gifPicker.style.display = gifPicker.style.display === 'none' ? 'flex' : 'none'; searchGifs('trending'); };
    document.getElementById('gif-search-input').oninput = (e) => searchGifs(e.target.value);

    async function searchGifs(query) {
        const url = query === 'trending' ? `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=10` : `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${query}&limit=10`;
        try {
            const res = await fetch(url);
            const data = await res.json();
            gifResults.innerHTML = '';
            data.data.forEach(g => {
                const img = document.createElement('img');
                img.src = g.images.fixed_height_small.url;
                img.onclick = () => { sendMessage('', g.images.fixed_height.url); gifPicker.style.display = 'none'; };
                gifResults.appendChild(img);
            });
        } catch (e) { }
    }

    // --- File Support ---
    document.getElementById('add-file-btn').onclick = () => document.getElementById('general-file-input').click();
    document.getElementById('general-file-input').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => sendMessage(`شارك ملفاً: ${file.name}`, null, ev.target.result, file.name);
        reader.readAsDataURL(file);
    };

    // --- Servers & Channels ---
    async function initServers() {
        const res = await fetch('/api/servers');
        const servers = await res.json();
        const sidebar = document.querySelector('.servers-sidebar');
        sidebar.querySelectorAll('.server-icon:not(.add-server):not(.discover):not(.active)').forEach(el => el.remove());

        servers.forEach(s => {
            if (s.id === 'rust-main') return;
            const div = document.createElement('div');
            div.className = 'server-icon';
            div.title = s.name;
            div.innerText = s.icon.length > 2 ? '' : s.icon;
            if (s.icon.length > 2) div.innerHTML = `<img src="${s.icon}">`;
            div.onclick = () => switchServer(s.id, s.name);
            sidebar.insertBefore(div, document.querySelector('.add-server'));
        });
    }

    function switchServer(id, name) {
        currentServer = id;
        document.querySelector('.sidebar-header h1').innerText = name;
        // Load channels for server... (simplified for now)
    }

    document.querySelector('.add-server').onclick = () => document.getElementById('add-server-modal').style.display = 'flex';
    document.getElementById('save-server-btn').onclick = async () => {
        const name = document.getElementById('new-server-name').value;
        const icon = document.getElementById('new-server-icon').value;
        if (name) {
            await fetch('/api/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, icon }) });
            location.reload();
        }
    };

    // --- Pinned Sidebar ---
    document.querySelector('.fa-thumbtack').onclick = () => pinnedSidebar.style.display = 'flex';
    document.getElementById('close-pinned').onclick = () => pinnedSidebar.style.display = 'none';
    function updatePinnedUI(pinned) {
        pinnedList.innerHTML = '';
        pinned.forEach(m => {
            const div = document.createElement('div');
            div.className = 'message';
            div.innerHTML = `<b>${m.author}</b>: ${m.text.substring(0, 50)}...`;
            pinnedList.appendChild(div);
        });
    }

    // --- Typing & Heartbeat ---
    input.onkeypress = (e) => { if (e.key === 'Enter') { sendMessage(input.value); input.value = ''; } };
    input.oninput = () => { sendMessageToTelegram(`[SYSTEM]:TYPING|${myUsername}`); clearTimeout(typingTimeout); typingTimeout = setTimeout(() => sendMessageToTelegram(`[SYSTEM]:STOP_TYPING|${myUsername}`), 2000); };

    async function sendHeartbeat() {
        if (!myUsername) return;
        await fetch('/api/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: myUsername, status: currentUser.status, customStatus: currentUser.customStatus }) });
    }

    async function fetchUsers() {
        const res = await fetch('/api/users');
        const data = await res.json();
        const onlineList = document.getElementById('members-online-list'), offlineList = document.getElementById('members-offline-list');
        onlineList.innerHTML = ''; offlineList.innerHTML = '';
        let on = 0, off = 0;
        data.forEach(u => {
            const isOnline = (Date.now() - (u.lastSeen || 0)) < 15000;
            const item = document.createElement('div');
            item.className = 'member-item';
            item.innerHTML = `
                <div class="avatar-wrapper"><img src="${u.avatar || 'https://via.placeholder.com/32'}"><div class="status ${isOnline ? u.status || 'online' : 'offline'}"></div></div>
                <div class="member-info">
                    <span class="member-name ${getRoleClass(u.username)}">${u.fullname || u.username}</span>
                    <div class="member-custom-status">${u.customStatus || ''}</div>
                </div>
            `;
            if (isOnline) { onlineList.appendChild(item); on++; } else { offlineList.appendChild(item); off++; }
        });
        document.getElementById('online-count').innerText = on;
        document.getElementById('offline-count').innerText = off;
    }

    // --- Shortcuts ---
    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'k') { e.preventDefault(); alert('البحث السريع قادم قريباً!'); }
        if (e.key === 'Escape') cancelReply();
    });

    // --- Existing Voice Logic --- (Simplified integration)
    const sendMessageToTelegram = sendMessage;
    const fetchMessagesFromServerInterval = setInterval(fetchMessagesFromServer, 3000);
    setInterval(fetchUsers, 10000);
    setInterval(sendHeartbeat, 5000);

    // Initial Notif Permission
    if (Notification.permission === 'default') Notification.requestPermission();
    function playNotif() { document.getElementById('notif-sound').play().catch(() => { }); }

    function handleSystemMessage(text) {
        // Voice Logic remains similar to before...
        if (text.startsWith('[SYSTEM]:TYPING|')) { typingUsers.add(text.split('|')[1]); updateTypingUI(); }
        else if (text.startsWith('[SYSTEM]:STOP_TYPING|')) { typingUsers.delete(text.split('|')[1]); updateTypingUI(); }
        else if (text.startsWith('[SYSTEM]:MUSIC_PLAY|')) {
            const query = text.split('|')[1];
            playMusicSync(query, false);
        }
        else if (text.startsWith('[SYSTEM]:MUSIC_PLAY_TG|')) {
            const query = text.split('|')[1];
            playMusicSync(query, true);
        }
        else if (text === '[SYSTEM]:MUSIC_STOP') {
            stopMusicSync();
        }
    }

    function updateTypingUI() {
        const u = Array.from(typingUsers).filter(x => x !== myUsername);
        document.getElementById('typing-indicator').innerText = u.length ? `${u.join(', ')} يكتب الآن...` : '';
    }
});
