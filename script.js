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
    let localStream = null, peer = null;
    const activeCalls = {};
    const audioContexts = {};
    let currentDMPeer = null;
    let autoRules = JSON.parse(localStorage.getItem('rust_cord_auto_rules')) || [];
    let mediaRecorder = null, audioChunks = [];

    // --- Elements ---
    const authScreen = document.getElementById('auth-screen'), mainApp = document.getElementById('main-app');
    const input = document.getElementById('chat-input'), messagesContainer = document.querySelector('.messages-container');
    const settingsModal = document.getElementById('settings-modal'), settingsForm = document.getElementById('settings-form');
    const gifPicker = document.getElementById('gif-picker'), gifResults = document.getElementById('gif-results');
    const pinnedSidebar = document.getElementById('pinned-sidebar'), pinnedList = document.getElementById('pinned-messages-list');
    const voicePanel = document.getElementById('voice-panel'), videoGrid = document.getElementById('video-grid');

    const GIPHY_KEY = 'dc6zaTOxFJmzC'; // Public Beta Key

    // --- Google Auth Integration ---
    window.handleGoogleCredentialResponse = async (response) => {
        try {
            const payload = JSON.parse(atob(response.credential.split('.')[1]));
            const googleUser = {
                id: 'google_' + payload.sub,
                email: payload.email,
                username: payload.email.split('@')[0],
                fullname: payload.name,
                bio: 'Logged in via Google',
                avatar: payload.picture,
                theme: 'dark-rust',
                status: 'online',
                pass: 'google-oauth-secure',
                xp: 0, coins: 0, level: 1
            };

            // Send to Server for DB sync and Telegram logging
            const res = await fetch('/api/auth/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(googleUser)
            });

            const data = await res.json();
            if (data.success) {
                // Update local storage with trusted server response
                let users = JSON.parse(localStorage.getItem('rust_cord_users')) || [];
                // Simple merge for local cache consistency
                const idx = users.findIndex(u => u.email === data.user.email);
                if (idx !== -1) users[idx] = data.user;
                else users.push(data.user);

                localStorage.setItem('rust_cord_users', JSON.stringify(users));
                loginUser(data.user);
            }
        } catch (e) {
            console.error('Google Login Error:', e);
            alert('حدث خطأ أثناء الاتصال بالخادم.');
        }
    };

    // Initialize Google Button
    const initGoogleBtn = () => {
        if (window.google) {
            google.accounts.id.initialize({
                client_id: "PUT_YOUR_CLIENT_ID_HERE.apps.googleusercontent.com", // ⚠️ USER MUST REPLACE THIS
                callback: window.handleGoogleCredentialResponse
            });
            google.accounts.id.renderButton(
                document.getElementById("google-btn-container"),
                { theme: "outline", size: "large", type: "standard", shape: "rectangular", text: "signin_with", logo_alignment: "left" }
            );
        } else {
            setTimeout(initGoogleBtn, 500);
        }
    };
    initGoogleBtn();

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

        // Update Level & Coins UI
        document.getElementById('user-lvl').innerText = user.level || 1;
        document.getElementById('user-coins').innerText = user.coins || 0;

        applyTheme(user.theme || 'dark-rust');
        fetchAnnouncement();

        authScreen.style.display = 'none';
        mainApp.style.display = 'flex';
        initServers();
        fetchUsers();
    }

    async function fetchAnnouncement() {
        const res = await fetch('/api/announcement');
        const data = await res.json();
        if (data && data.active) {
            const banner = document.getElementById('announcement-banner');
            banner.style.display = 'flex';
            document.getElementById('announcement-text').innerText = data.text;
            setTimeout(() => {
                banner.style.opacity = '0';
                setTimeout(() => banner.style.display = 'none', 500);
            }, 10000);
        }
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
                await sendMessage(`[SYSTEM]:MUSIC_PLAY_TG|${query}`);
            } else {
                await sendMessage(`[SYSTEM]:MUSIC_PLAY|${query}`);
            }
            return true;
        } else if (text === '#ايقاف') {
            await sendMessage(`[SYSTEM]:MUSIC_STOP`);
            return true;
        }
        return false;
    }

    async function playMusicSync(query, isTg = false) {
        musicPlayerBar.style.display = 'flex';
        ytContainer.style.display = 'block'; // Show the player container
        musicTitle.innerText = `جاري البحث: ${query}...`;

        // Add "Music Bot" to the current voice channel list visually
        if (currentChannel) {
            const list = document.getElementById(`voice-users-${currentChannel}`);
            if (list && !document.getElementById('voice-user-bot')) {
                const item = document.createElement('div');
                item.className = 'voice-user-item bot-user';
                item.id = 'voice-user-bot';
                item.innerHTML = `<img src="https://img.icons8.com/fluency/48/bot.png"><span>Music Bot 🤖</span>`;
                list.appendChild(item);
            }
        }

        if (isTg) {
            try {
                const botToken = '6780979570:AAEpS358Uxk_FuegiXu80-ElfxnVFE_AQrU';
                const res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?allowed_updates=["message","channel_post"]`);
                const data = await res.json();

                let updates = data.result || [];
                const targetUser = query.replace('@', '').toLowerCase();

                // Filter by channel/user if specific one requested
                if (query.startsWith('@')) {
                    updates = updates.filter(u => {
                        const chat = u.message?.chat || u.channel_post?.chat;
                        return chat && chat.username && chat.username.toLowerCase() === targetUser;
                    });
                }

                // Extract Audios
                let audioFiles = updates.flatMap(u => {
                    const msg = u.message || u.channel_post;
                    return (msg && msg.audio) ? [{ id: msg.audio.file_id, name: msg.audio.title || 'مقطع صوتي' }] : [];
                });

                if (audioFiles.length > 0) {
                    const audio = audioFiles[audioFiles.length - 1]; // Play latest
                    musicTitle.innerText = `تشغيل من تيليجرام: ${audio.name}`;
                    ytContainer.innerHTML = `<audio id="bot-audio-player" controls autoplay src="/api/tg-audio/${audio.id}" style="width:100%; height:30px;"></audio>`;
                } else {
                    musicTitle.innerText = `⚠️ لم يتم العثور على صوتيات حديثة في ${query}`;
                    // setTimeout(stopMusicSync, 5000);
                }
            } catch (e) {
                console.error(e);
                musicTitle.innerText = 'خطأ في الاتصال بتيليجرام';
            }
        } else {
            // Smart YouTube Parser
            const urlPattern = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
            const match = query.match(urlPattern);
            let embedUrl = '';

            if (match && match[1]) {
                musicTitle.innerText = `جاري تشغيل فيديو...`;
                embedUrl = `https://www.youtube.com/embed/${match[1]}?autoplay=1&enablejsapi=1`;
            } else {
                musicTitle.innerText = `نتائج البحث عن: ${query}`;
                embedUrl = `https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(query)}&autoplay=1&origin=${window.location.origin}`;
            }

            ytContainer.innerHTML = `<iframe id="bot-video-player" width="100%" height="200" src="${embedUrl}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
        }
    }

    function stopMusicSync() {
        musicPlayerBar.style.display = 'none';
        ytContainer.style.display = 'none'; // Hide container
        ytContainer.innerHTML = '';
        const botEl = document.getElementById('voice-user-bot');
        if (botEl) botEl.remove();
    }

    document.getElementById('music-stop').onclick = () => {
        sendMessage(`[SYSTEM]:MUSIC_STOP`);
    };

    // --- Media & PeerJS Core ---
    function initPeer() {
        if (peer) return;
        peer = new Peer();
        peer.on('open', (id) => {
            console.log('Peer ID:', id);
            if (currentChannel) broadcastStreamUpdate();
        });
        peer.on('call', (call) => {
            console.log('Receiving call from:', call.peer);
            call.answer(localStream || new MediaStream());
            call.on('stream', (rs) => handleRemoteStream(rs, call.peer));
            activeCalls[call.peer] = call;
        });
        peer.on('error', (err) => console.error('PeerJS Error:', err));
    }

    function handleRemoteStream(stream, pid) {
        console.log('Handling stream for:', pid);
        let container = document.getElementById(`container-${pid}`);
        if (!container) {
            container = document.createElement('div');
            container.className = 'video-item';
            container.id = `container-${pid}`;

            const v = document.createElement('video');
            v.id = `video-${pid}`;
            v.autoplay = true;
            v.playsinline = true;

            const lbl = document.createElement('div');
            lbl.className = 'video-label';
            lbl.innerText = `مستخدم #${pid.substring(0, 4)}`;

            container.appendChild(v);
            container.appendChild(lbl);
            videoGrid.appendChild(container);
        }

        const videoEl = document.getElementById(`video-${pid}`);
        videoEl.srcObject = stream;

        // Show grid if there's at least one video track
        if (stream.getVideoTracks().length > 0) {
            videoGrid.style.display = 'grid';
            container.style.display = 'block';
        } else {
            // It's audio only, but we keep the element for sound
            // Maybe hide the container if it's just audio? 
            // In Discord, audio-only users don't show in the video grid unless they have a cam.
            container.style.display = 'none';
        }
    }

    async function broadcastStreamUpdate() {
        if (peer && peer.id && currentChannel) {
            await sendMessageToTelegram(`[SYSTEM]:VOICE_JOIN|${peer.id}|${currentChannel}|${currentUser.fullname || currentUser.username}|${currentUser.avatar || ''}`);

            // Register with server persistence
            await fetch('/api/voice/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: myUsername,
                    channelId: currentChannel,
                    peerId: peer.id,
                    avatar: currentUser.avatar
                })
            });
            // Force immediate sync to show stable state
            setTimeout(syncVoiceStates, 500);
        }
    }

    async function replaceTracksInCalls(newStream) {
        const videoTrack = newStream.getVideoTracks()[0];
        const audioTrack = newStream.getAudioTracks()[0];

        for (let pid in activeCalls) {
            const call = activeCalls[pid];
            if (call.peerConnection) {
                const senders = call.peerConnection.getSenders();
                const vSender = senders.find(s => s.track && s.track.kind === 'video');
                const aSender = senders.find(s => s.track && s.track.kind === 'audio');

                if (vSender && videoTrack) vSender.replaceTrack(videoTrack);
                if (aSender && audioTrack) aSender.replaceTrack(audioTrack);
            }
        }
    }

    async function joinVoiceChannel(name) {
        if (currentChannel === name && voicePanel.style.display === 'flex') return;

        currentChannel = name;
        initPeer();

        try {
            if (localStream) {
                localStream.getTracks().forEach(t => t.stop());
            }
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: isCameraOn
            });

            voicePanel.style.display = 'flex';
            voicePanel.querySelector('.channel-name').innerText = name;

            // Optimistic UI: Show myself immediately
            const vList = document.getElementById(`voice-users-${name}`);
            if (vList) {
                // Remove existing self if any
                const existing = [...vList.children].find(c => c.innerHTML.includes(myUsername));
                if (!existing) {
                    const item = document.createElement('div');
                    item.className = 'voice-user-item';
                    item.innerHTML = `<img src="${currentUser.avatar || 'https://via.placeholder.com/32'}"><span>${myUsername}</span>`;
                    vList.appendChild(item);
                }
            }

            if (peer && peer.id) {
                broadcastStreamUpdate();
            }
            updateLocalVideo(); // Ensure local UI reflects state
        } catch (e) {
            console.error('Mic Access Error:', e);
            alert('تعذر الوصول للميكروفون أو الكاميرا. تأكد من إعطاء الإذن بالوصول (Allow).');
            currentChannel = null;
        }
    }

    async function leaveVoice() {
        if (peer && peer.id && currentChannel) {
            await sendMessageToTelegram(`[SYSTEM]:VOICE_LEAVE|${peer.id}|${currentChannel}`);
            await fetch('/api/voice/leave', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: myUsername })
            });
        }
        if (localStream) {
            localStream.getTracks().forEach(t => t.stop());
            localStream = null;
        }
        for (let pid in activeCalls) {
            activeCalls[pid].close();
            delete activeCalls[pid];
        }
        videoGrid.style.display = 'none';
        videoGrid.innerHTML = '';
        voicePanel.style.display = 'none';
        currentChannel = null; // Reset channel on leave
    }

    document.querySelector('.user-info').onclick = () => {
        document.getElementById('settings-fullname').value = currentUser.fullname || '';
        document.getElementById('settings-bio').value = currentUser.bio || '';
        document.getElementById('settings-avatar').value = currentUser.avatar || '';
        document.getElementById('settings-avatar-preview').src = currentUser.avatar || 'https://via.placeholder.com/60';
        document.getElementById('settings-status').value = currentUser.status || 'online';
        document.getElementById('settings-theme').value = currentUser.theme || 'dark-rust';
        document.getElementById('settings-custom-status').value = currentUser.customStatus || '';
        settingsModal.style.display = 'flex';
    };

    // --- Profile Image Upload ---
    document.getElementById('avatar-file-input').onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                document.getElementById('settings-avatar-preview').src = ev.target.result;
                document.getElementById('settings-avatar').value = ev.target.result;
            };
            reader.readAsDataURL(file);
        }
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

    async function getCircularCrop(dataUrl, size = 128) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');
                const min = Math.min(img.width, img.height);
                const x = (img.width - min) / 2;
                const y = (img.height - min) / 2;
                ctx.drawImage(img, x, y, min, min, 0, 0, size, size);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.src = dataUrl;
        });
    }

    document.getElementById('avatar-file-input').onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async (ev) => {
                const cropped = await getCircularCrop(ev.target.result);
                document.getElementById('settings-avatar-preview').src = cropped;
                document.getElementById('settings-avatar').value = cropped;
            };
            reader.readAsDataURL(file);
        }
    };

    document.getElementById('logout-btn').onclick = () => { localStorage.removeItem('rust_cord_user'); location.reload(); };
    document.getElementById('close-settings').onclick = () => settingsModal.style.display = 'none';
    document.getElementById('cancel-settings').onclick = () => settingsModal.style.display = 'none';

    // --- Messaging Core ---
    async function sendMessage(text, imageUrl = null, fileData = null, fileName = null, audioData = null) {
        try {
            // Check for music commands
            const isMusic = await handleMusicCommand(text);
            if (isMusic) return;

            // Detect URL for Smart Preview
            const urlMatch = text.match(/https?:\/\/[^\s]+/);
            let linkPreview = null;
            if (urlMatch && !audioData) {
                const res = await fetch(`/api/link-preview?url=${encodeURIComponent(urlMatch[0])}`);
                linkPreview = await res.json();
            }

            // Auto-Responder logic
            autoRules.forEach(rule => {
                if (text === rule.trigger) {
                    setTimeout(() => addMessage('System Bot 🤖', rule.response, false, null, Date.now() + 1), 500);
                }
            });

            await fetch('/api/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ author: myUsername, text, imageUrl, replyTo: replyingToId, fileData, fileName, audioData, linkPreview, channelId: currentChannel })
            });
            cancelReply();
            fetchMessagesFromServer(); // Refresh stats (coins/XP)
        } catch (e) { console.error(e); }
    }

    async function fetchMessagesFromServer() {
        try {
            if (!currentChannel) return;
            const res = await fetch(`/api/messages?channelId=${currentChannel}`);
            const msgs = await res.json();
            const pinned = msgs.filter(m => m.pinned);
            updatePinnedUI(pinned);

            msgs.forEach(msg => {
                if (!loadedMessages.has(msg.id)) {
                    loadedMessages.add(msg.id);
                    if (msg.text.startsWith('[SYSTEM]:')) handleSystemMessage(msg.text);
                    else addMessage(msg.author, msg.text, msg.author === myUsername, msg.imageUrl, msg.id, msg.replyTo, msg.reactions, msg.pinned, msg.fileName, msg.fileData, msg.audioData, msg.linkPreview);
                } else {
                    updateMessageUI(msg);
                }
            });
        } catch (e) { }
    }

    function addMessage(author, text, isUser, img, id, replyId, reactions = {}, isPinned = false, fileName = null, fileData = null, audioData = null, linkPreview = null) {
        const div = document.createElement('div');
        div.className = `message ${isPinned ? 'pinned-msg' : ''}`;
        div.id = `msg-${id}`;

        const roleClass = getRoleClass(author);
        const avatar = (author === myUsername && currentUser && currentUser.avatar) ? currentUser.avatar : `https://ui-avatars.com/api/?name=${author || 'User'}&background=random`;

        const textContent = document.createElement('div');
        textContent.className = 'message-text-content';
        textContent.innerHTML = parseMarkdown(text);

        if (audioData) {
            const player = document.createElement('div');
            player.className = 'voice-msg-player';
            player.innerHTML = `<i class="fas fa-play" onclick="window.playVoice(this, '${audioData}')"></i><div class="voice-wave"></div><span>رسالة صوتية</span>`;
            textContent.appendChild(player);
        }

        if (linkPreview) {
            const card = document.createElement('div');
            card.className = 'link-preview-card';
            card.innerHTML = `
                ${linkPreview.img ? `<img src="${linkPreview.img}">` : ''}
                <div class="link-preview-info">
                    <h5>${linkPreview.title || 'رابط'}</h5>
                    <p>${linkPreview.desc || ''}</p>
                    <small style="color:var(--accent-color)">${linkPreview.url}</small>
                </div>
            `;
            card.onclick = () => window.open(linkPreview.url, '_blank');
            textContent.appendChild(card);
        }

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
                    <span class="message-timestamp">${new Date(Number(id)).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}</span>
                    ${isPinned ? '<i class="fas fa-thumbtack pin-indicator"></i>' : ''}
                </div>
                ${textContent.outerHTML}
                ${img ? `<img src="${img}" class="chat-img" onclick="window.open('${img}')">` : ''}
                ${fileData ? `<div class="file-share"><i class="fas fa-file"></i> <a href="${fileData}" download="${fileName}">${fileName}</a></div>` : ''}
                ${reactHtml}
            </div>
            <div class="message-actions">
                <i class="fas fa-smile" onclick="window.showEmojiPick('${id}')" title="تفاعل"></i>
                <i class="fas fa-reply" onclick="window.prepReply('${id}', '${author}', '${text.replace(/'/g, "\\'").replace(/\n/g, "\\n")}')" title="رد"></i>
                <i class="fas fa-thumbtack" onclick="window.togglePin('${id}', ${!isPinned})" title="${isPinned ? 'إلغاء التثبيت' : 'تثبيت'}"></i>
                ${(author === myUsername || isAdmin) ? `<i class="fas fa-edit" onclick="window.editMessage('${id}', '${text.replace(/'/g, "\\'").replace(/\n/g, "\\n")}')"></i>` : ''}
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

    function parseMarkdown(text) {
        return text
            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/@(\w+)/g, '<span class="mention" onclick="window.showUserProfile(\'$1\')">@$1</span>');
    }
    function getRoleClass(u) { if (!u) return 'role-member'; return (u === 'sww' || u.includes('المطور')) ? 'role-owner' : (u.toLowerCase().includes('admin') ? 'role-admin' : 'role-member'); }
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
        if (e.key === 'Escape') cancelReply();
    });

    // --- Existing Voice Logic --- (Simplified integration)
    const sendMessageToTelegram = sendMessage;
    // --- Optimization: Reduced polling to fix lag ---
    const fetchMessagesFromServerInterval = setInterval(fetchMessagesFromServer, 4000);
    setInterval(fetchUsers, 15000);
    setInterval(sendHeartbeat, 8000);
    setInterval(syncVoiceStates, 5000); // Sync voice users every 5s

    async function syncVoiceStates() {
        try {
            const res = await fetch('/api/voice-states');
            const states = await res.json();

            // We only clear if we have data to replace, to avoid flicker
            // Better strategy: Clear all lists then repopulate. 
            // Since this runs every 5s, we want to be careful not to kill our own optimistic adding.
            // But the server is the source of truth.

            document.querySelectorAll('.voice-user-list').forEach(l => l.innerHTML = '');

            states.forEach(s => {
                const list = document.getElementById(`voice-users-${s.channelId}`);
                if (list) {
                    const item = document.createElement('div');
                    item.className = 'voice-user-item';
                    item.id = `voice-user-${s.peerId}`;
                    item.innerHTML = `<img src="${s.avatar || 'https://via.placeholder.com/32'}"><span>${s.username}</span>`;
                    list.appendChild(item);
                }
            });
        } catch (e) { }
    }

    // Initial Notif Permission
    if (Notification.permission === 'default') Notification.requestPermission();
    function playNotif() { document.getElementById('notif-sound').play().catch(() => { }); }

    function handleSystemMessage(text) {
        if (text.startsWith('[SYSTEM]:ANNOUNCEMENT|')) {
            const msg = text.split('|')[1];
            addMessage('إعلان 📢', msg, false, null, Date.now(), null, {}, false, null, null, null, null);
        } else if (text.startsWith('[SYSTEM]:ADMIN_UPDATE|')) {
            const msg = text.split('|')[1];
            addMessage('تحديث إداري 🛠️', msg, false, null, Date.now(), null, {}, false, null, null, null, null);
        } else if (text.startsWith('[SYSTEM]:WATCH_JOIN|')) {
            const url = text.split('|')[1];
            window.syncWatchTogether(url);
        } else if (text.startsWith('[SYSTEM]:VOICE_JOIN|')) {
            const parts = text.split('|');
            const peerId = parts[1], rm = parts[2], un = parts[3], av = parts[4];

            // Sync voice user list in sidebar
            const list = document.getElementById(`voice-users-${rm}`);
            if (list && !document.getElementById(`voice-user-${peerId}`)) {
                const item = document.createElement('div');
                item.className = 'voice-user-item';
                item.id = `voice-user-${peerId}`;
                item.innerHTML = `<img src="${av || `https://ui-avatars.com/api/?name=${un}&background=random`}"><span>${un}</span>`;
                list.appendChild(item);
            }

            // Call the joining user if we are in the same room
            if (peer && peer.id && peerId !== peer.id && rm === currentChannel) {
                console.log('Calling peer:', peerId);
                // Allow calling even if we don't have a mic/cam yet (passive listener)
                const call = peer.call(peerId, localStream || new MediaStream());
                if (call) {
                    call.on('stream', (rs) => handleRemoteStream(rs, peerId));
                    activeCalls[peerId] = call;
                }
            }
        } else if (text.startsWith('[SYSTEM]:VOICE_LEAVE|')) {
            const pid = text.split('|')[1];
            const el = document.getElementById(`voice-user-${pid}`);
            if (el) el.remove();

            const container = document.getElementById(`container-${pid}`);
            if (container) container.remove();

            if (activeCalls[pid]) {
                activeCalls[pid].close();
                delete activeCalls[pid];
            }
        } else if (text.startsWith('[SYSTEM]:TYPING|')) { typingUsers.add(text.split('|')[1]); updateTypingUI(); }
        else if (text.startsWith('[SYSTEM]:STOP_TYPING|')) { typingUsers.delete(text.split('|')[1]); updateTypingUI(); }
        else if (text.startsWith('[SYSTEM]:MUSIC_PLAY|')) { playMusicSync(text.split('|')[1], false); }
        else if (text.startsWith('[SYSTEM]:MUSIC_PLAY_TG|')) { playMusicSync(text.split('|')[1], true); }
        else if (text === '[SYSTEM]:MUSIC_STOP') { stopMusicSync(); }
    }

    // --- Interactive Listeners ---
    document.querySelectorAll('.channel').forEach(c => {
        c.onclick = () => {
            const name = c.querySelector('span').innerText;
            if (c.classList.contains('voice-channel')) joinVoiceChannel(name);
            else {
                if (currentChannel === name) return;
                document.querySelectorAll('.channel').forEach(ch => ch.classList.remove('active'));
                c.classList.add('active');
                currentChannel = name; // Update global state
                document.querySelector('.chat-header h2').innerText = name;
                input.placeholder = `إرسال إلى #${name}`;

                // Clear messages and reload for new channel
                messagesContainer.innerHTML = '';
                loadedMessages = new Set();
                fetchMessagesFromServer();
            }
        };
    });

    document.getElementById('leave-voice-btn').onclick = leaveVoice;

    document.getElementById('camera-btn').onclick = async function () {
        try {
            isCameraOn = !isCameraOn;
            this.classList.toggle('active', isCameraOn);

            const stream = await navigator.mediaDevices.getUserMedia({
                video: isCameraOn,
                audio: true
            });

            if (localStream) {
                // If we are already in a call, we replace the tracks
                replaceTracksInCalls(stream);
                localStream.getTracks().forEach(t => t.stop());
            }
            localStream = stream;
            updateLocalVideo();
            broadcastStreamUpdate(); // Notify others to refresh if needed
        } catch (e) {
            console.error('Camera Access Error:', e);
            isCameraOn = false;
            this.classList.remove('active');
        }
    };

    document.getElementById('screen-btn').onclick = async function () {
        try {
            isScreenSharing = !isScreenSharing;
            this.classList.toggle('active', isScreenSharing);

            let stream;
            if (isScreenSharing) {
                stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                stream.getVideoTracks()[0].onended = () => {
                    isScreenSharing = false;
                    this.classList.remove('active');
                    // Fallback to camera or mic only
                    navigator.mediaDevices.getUserMedia({ video: isCameraOn, audio: true }).then(s => {
                        replaceTracksInCalls(s);
                        localStream = s;
                        updateLocalVideo();
                    });
                };
            } else {
                stream = await navigator.mediaDevices.getUserMedia({ video: isCameraOn, audio: true });
            }

            replaceTracksInCalls(stream);
            if (localStream) localStream.getTracks().forEach(t => t.stop());
            localStream = stream;
            updateLocalVideo();
            broadcastStreamUpdate();
        } catch (e) {
            console.error('Screen Share Error:', e);
            isScreenSharing = false;
            this.classList.remove('active');
        }
    };

    function updateLocalVideo() {
        let v = document.getElementById('local-video');
        if (isCameraOn || isScreenSharing) {
            videoGrid.style.display = 'grid';
            if (!v) {
                const div = document.createElement('div');
                div.className = 'video-item';
                div.id = 'container-local';
                v = document.createElement('video');
                v.id = 'local-video';
                v.autoplay = true;
                v.muted = true;
                v.playsinline = true;
                const lbl = document.createElement('div');
                lbl.className = 'video-label';
                lbl.innerText = 'أنت';
                div.appendChild(v);
                div.appendChild(lbl);
                videoGrid.prepend(div);
            }
            v.srcObject = localStream;
        } else {
            const el = document.getElementById('container-local');
            if (el) el.remove();
            if (videoGrid.querySelectorAll('.video-item').length === 0) {
                videoGrid.style.display = 'none';
            }
        }
    }

    // Control Buttons
    document.querySelector('.fa-microphone').parentElement.onclick = function () {
        const icon = this.querySelector('i');
        icon.classList.toggle('fa-microphone-slash');
        if (localStream) {
            localStream.getAudioTracks()[0].enabled = !icon.classList.contains('fa-microphone-slash');
        }
        this.classList.toggle('active', icon.classList.contains('fa-microphone-slash'));
    };

    document.querySelector('.fa-headphones').parentElement.onclick = function () {
        const icon = this.querySelector('i');
        icon.classList.toggle('fa-volume-mute');
        const isDeaf = icon.classList.contains('fa-volume-mute');
        this.classList.toggle('active', isDeaf);

        document.querySelectorAll('video, audio').forEach(el => {
            if (el.id !== 'local-video') el.muted = isDeaf;
        });
    };

    document.querySelector('.fa-cog').parentElement.onclick = () => document.querySelector('.user-info').click();

    function updateTypingUI() {
        const u = Array.from(typingUsers).filter(x => x !== myUsername);
        document.getElementById('typing-indicator').innerText = u.length ? `${u.join(', ')} يكتب الآن...` : '';
    }

    // --- Global Search (Ctrl + K) ---
    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'k') {
            e.preventDefault();
            document.getElementById('search-modal').style.display = 'flex';
            document.getElementById('global-search-input').focus();
        }
    });

    document.getElementById('global-search-input').oninput = async (e) => {
        const query = e.target.value.toLowerCase();
        const results = document.getElementById('search-results');
        if (!query) { results.innerHTML = ''; return; }

        try {
            const res = await fetch('/api/messages');
            const msgs = await res.json();
            const filtered = msgs.filter(m => m.text.toLowerCase().includes(query) || m.author.toLowerCase().includes(query));

            results.innerHTML = filtered.map(m => `
                <div class="search-item" onclick="document.getElementById('search-modal').style.display='none'; document.getElementById('msg-${m.id}')?.scrollIntoView()">
                    <span class="search-meta">${m.author} • ${new Date(m.timestamp).toLocaleDateString()}</span>
                    <div class="search-text">${m.text.substring(0, 80)}...</div>
                </div>
            `).join('');
        } catch (e) { }
    };

    // --- Role Shop ---
    window.showShop = async () => {
        const res = await fetch('/api/shop');
        const items = await res.json();
        const list = document.getElementById('shop-items-list');
        list.innerHTML = items.map(i => `
            <div class="shop-item">
                <i class="fas fa-crown" style="color:${i.color}; font-size:30px;"></i>
                <h4>${i.name}</h4>
                <span class="price">${i.price} <i class="fas fa-coins"></i></span>
                <button class="btn-save" onclick="window.buyItem('${i.id}')">شراء</button>
            </div>
        `).join('');
        document.getElementById('shop-modal').style.display = 'flex';
    };

    window.buyItem = async (itemId) => {
        const res = await fetch('/api/shop/buy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: myUsername, itemId })
        });
        const data = await res.json();
        if (data.success) {
            alert('تهانينا! تم شراء الرتبة بنجاح.');
            loginUser(data.user);
            document.getElementById('shop-modal').style.display = 'none';
        } else alert('عذراً، رصيدك غير كافٍ أو حدث خطأ.');
    };

    // --- DM System ---
    window.openDM = async (username) => {
        if (username === myUsername) return;
        currentDMPeer = username;
        document.getElementById('dm-target-name').innerText = `دردشة خاصة مع @${username}`;
        document.getElementById('dm-modal').style.display = 'flex';
        fetchDMs();
    };

    async function fetchDMs() {
        if (!currentDMPeer) return;
        const res = await fetch(`/api/dms/${myUsername}/${currentDMPeer}`);
        const dms = await res.json();
        const container = document.getElementById('dm-messages');
        container.innerHTML = dms.map(d => `
            <div class="dm-msg ${d.from === myUsername ? 'sent' : 'received'}">
                <small>${d.from}</small>
                <div>${d.text}</div>
            </div>
        `).join('');
        container.scrollTop = container.scrollHeight;
    }

    window.sendDM = async () => {
        const text = document.getElementById('dm-input').value;
        if (!text) return;
        await fetch('/api/dms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: myUsername, to: currentDMPeer, text })
        });
        document.getElementById('dm-input').value = '';
        fetchDMs();
    };

    // --- Admin Dashboard ---
    window.showAdminTab = (tab) => {
        document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none');
        document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
        // Find button active state
        document.querySelectorAll('.admin-tab-btn').forEach(b => {
            if (b.getAttribute('onclick').includes(tab)) b.classList.add('active');
        });

        document.getElementById(`admin-${tab}-tab`).style.display = 'block';
        if (tab === 'mod') fetchAdminUserList();
        if (tab === 'auto') renderAutoRules();
        if (tab === 'logs') fetchAuditLogs();
        if (tab === 'roles') fetchRoles();
    };

    async function fetchAuditLogs() {
        try {
            const res = await fetch('/api/admin/audit-logs');
            const logs = await res.json();
            const list = document.getElementById('audit-log-list');
            list.innerHTML = logs.map(l => `
                <div style="background:#2b2d31; padding:10px; border-radius:4px; border-left:4px solid #f1c40f;">
                    <small style="color:#b5bac1">${new Date(l.timestamp).toLocaleString()}</small>
                    <div style="color:#fff">
                        <b>${l.admin}</b> did <b>${l.action}</b> on <b>${l.target}</b>
                    </div>
                    <div style="color:#b5bac1; font-size:12px;">${l.details}</div>
                </div>
            `).join('');
        } catch (e) { }
    }

    async function createRole() {
        const name = document.getElementById('new-role-name').value;
        const color = document.getElementById('new-role-color').value;
        if (name) {
            await fetch('/api/admin/roles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, color, permissions: [] })
            });
            fetchRoles();
        }
    }

    async function fetchRoles() {
        const res = await fetch('/api/admin/roles');
        const roles = await res.json();
        const list = document.getElementById('roles-list');
        list.innerHTML = roles.map(r => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:#2b2d31; padding:8px; margin-top:5px; border-radius:4px;">
                <span style="color:${r.color}; font-weight:bold;">${r.name}</span>
                <span style="font-size:12px; color:#aaa;">ID: ${r.id}</span>
            </div>
         `).join('');
    }

    async function fetchAdminUserList() {
        const res = await fetch('/api/users');
        const users = await res.json();
        const list = document.getElementById('admin-user-list');
        list.innerHTML = users.map(u => `
            <div class="admin-user-item">
                <span>${u.fullname || u.username} (@${u.username})</span>
                <div class="admin-actions">
                    <button class="btn-kick" onclick="window.adminAction('kick', '${u.username}')">طرد</button>
                    <button class="btn-ban" onclick="window.adminAction('ban', '${u.username}')">حظر</button>
                </div>
            </div>
        `).join('');
    }

    window.adminAction = async (action, username) => {
        if (!isAdmin) return alert('ليست لديك صلاحية!');
        const reason = prompt('سبب الإجراء؟');
        await fetch(`/api/admin/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, adminName: myUsername, reason })
        });
        alert(`تم تنفيذ ${action} بنجاح`);
        fetchAdminUserList();
    };

    window.addAutoRule = () => {
        const trigger = document.getElementById('auto-trigger').value;
        const response = document.getElementById('auto-response').value;
        if (trigger && response) {
            autoRules.push({ trigger, response });
            localStorage.setItem('rust_cord_auto_rules', JSON.stringify(autoRules));
            renderAutoRules();
            document.getElementById('auto-trigger').value = '';
            document.getElementById('auto-response').value = '';
        }
    };

    function renderAutoRules() {
        const list = document.getElementById('auto-rules-list');
        list.innerHTML = autoRules.map((r, i) => `
            <div class="admin-user-item">
                <span>"${r.trigger}" ➡ "${r.response}"</span>
                <button class="btn-ban" onclick="window.deleteAutoRule(${i})">حذف</button>
            </div>
        `).join('');
    }

    window.deleteAutoRule = (i) => {
        autoRules.splice(i, 1);
        localStorage.setItem('rust_cord_auto_rules', JSON.stringify(autoRules));
        renderAutoRules();
    };

    // --- Channel Management ---
    // Inject "Add Channel" button into sidebar header if Admin
    const sidebarHeader = document.querySelector('.sidebar-header');
    if (isAdmin && !document.getElementById('add-channel-btn-icon')) {
        const addBtn = document.createElement('i');
        addBtn.className = 'fas fa-plus';
        addBtn.id = 'add-channel-btn-icon';
        addBtn.style.cursor = 'pointer';
        addBtn.style.marginLeft = '10px';
        addBtn.title = 'إنشاء قناة';
        addBtn.onclick = () => document.getElementById('create-channel-modal').style.display = 'flex';
        sidebarHeader.insertBefore(addBtn, sidebarHeader.querySelector('h1'));
    }

    document.getElementById('create-channel-btn').onclick = async () => {
        const name = document.getElementById('new-channel-name').value;
        const type = document.getElementById('new-channel-type').value;
        const pass = document.getElementById('new-channel-pass').value;
        const limit = document.getElementById('new-channel-limit').value;

        if (name) {
            await fetch('/api/channels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, type, password: pass, limit: parseInt(limit), serverId: currentServer })
            });
            location.reload();
        }
    };

    // --- Enhanced Channel Joining ---
    // We need to fetch channel details to know if they are locked
    let serverChannels = []; // Cache to store current server channels details

    const originalInitServers = initServers;
    initServers = async () => {
        // We override this to get channel Data, or we just fetch it separately
        const res = await fetch('/api/servers');
        const servers = await res.json();
        const server = servers.find(s => s.id === currentServer);
        if (server) {
            serverChannels = server.channels;
            renderChannels(server.channels);
        }

        // Re-run original logic for sidebar icons
        const sidebar = document.querySelector('.servers-sidebar');
        sidebar.querySelectorAll('.server-icon:not(.add-server):not(.discover):not(.active)').forEach(el => el.remove());
        servers.forEach(s => {
            if (s.id === 'rust-main') return;
            const div = document.createElement('div');
            div.className = 'server-icon';
            div.innerText = s.icon.length > 2 ? '' : s.icon;
            if (s.icon.length > 2) div.innerHTML = `<img src="${s.icon}">`;
            div.onclick = () => { currentServer = s.id; initServers(); }; // recursive reload
            sidebar.insertBefore(div, document.querySelector('.add-server'));
        });
    };

    // Explicit Render Function to handle Locks
    function renderChannels(channels) {
        const list = document.querySelector('.channels-list');
        list.innerHTML = ''; // Clear current

        // Group by type
        const textChannels = channels.filter(c => c.type === 'text');
        const voiceChannels = channels.filter(c => c.type === 'voice');

        // Text Section
        if (textChannels.length > 0) {
            const h = document.createElement('h3'); h.innerText = 'ROOMS'; list.appendChild(h);
            textChannels.forEach(c => {
                const div = document.createElement('div');
                div.className = `channel ${currentChannel === c.id ? 'active' : ''}`;
                div.innerHTML = `<span><i class="fas fa-hashtag"></i> ${c.name}</span>`;
                div.onclick = () => switchTxChannel(c);
                list.appendChild(div);
            });
        }

        // Voice Section
        if (voiceChannels.length > 0) {
            const h = document.createElement('h3'); h.innerText = 'VOICE CHANNELS'; list.appendChild(h);
            voiceChannels.forEach(c => {
                const div = document.createElement('div');
                div.className = `channel voice-channel ${currentChannel === c.id ? 'active' : ''}`;
                const isLocked = !!c.password;
                div.innerHTML = `
                    <span>
                        <i class="fas ${isLocked ? 'fa-lock' : 'fa-volume-up'}"></i> 
                        ${c.name} 
                        ${c.limit ? `<small style="font-size:10px; float:left">(${c.limit})</small>` : ''}
                    </span>
                    <div class="voice-user-list" id="voice-users-${c.id}"></div>
                `;
                div.onclick = () => tryJoinVoice(c);
                list.appendChild(div);
            });
        }
    }

    function switchTxChannel(c) {
        if (currentChannel === c.id) return;
        document.querySelectorAll('.channel').forEach(ch => ch.classList.remove('active'));
        currentChannel = c.id;
        document.querySelector('.chat-header h2').innerText = c.name;
        // Reload messages...
        messagesContainer.innerHTML = '';
        loadedMessages = new Set();
        fetchMessagesFromServer();
    }

    async function tryJoinVoice(c) {
        // 1. Check User Limit
        const userCount = document.getElementById(`voice-users-${c.id}`)?.children.length || 0;
        if (c.limit > 0 && userCount >= c.limit) {
            return alert('عذراً، الروم ممتلئ!');
        }

        // 2. Check Password
        if (c.password) {
            const input = prompt('🔒 هذا الروم محمي بكلمة مرور. أدخل الباسورد:');
            if (input !== c.password) return alert('كلمة المرور خاطئة!');
        }

        // 3. Join
        joinVoiceChannel(c.id); // Assuming ID is passed, logic update needed in joinVoiceChannel if it expects name
    }

    // Update joinVoiceChannel to accept ID
    const originalJoin = joinVoiceChannel;
    joinVoiceChannel = async (idOrName) => {
        // Start join process
        // We find the channel object to get the Name for UI
        const ch = serverChannels.find(c => c.id === idOrName) || { name: idOrName };

        // Use ID for tracking currentChannel
        // But original code used name strings as IDs sometimes. 
        // Let's standardise: currentChannel = ID.
        // Update voice panel name
        voicePanel.querySelector('.channel-name').innerText = ch.name;

        // Calls original logic but override currentChannel var inside it via global scope
        currentChannel = idOrName;
        initPeer();

        // Refactored Logic from original function (inline here to ensure proper execution flow)
        try {
            if (localStream) localStream.getTracks().forEach(t => t.stop());
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isCameraOn });
            voicePanel.style.display = 'flex';

            // Allow calling...
            if (peer && peer.id) broadcastStreamUpdate();
            updateLocalVideo();
        } catch (e) {
            console.error(e);
            alert('Mic Error');
        }
    };
    fetchUsers = async () => {
        await originalFetchUsers();
        document.querySelectorAll('.member-item').forEach(item => {
            const userName = item.querySelector('.member-name').innerText.split('(@')[1]?.replace(')', '') || item.querySelector('.member-name').innerText;
            item.onclick = () => window.showUserProfile(userName);
            item.title = 'عرض الملف الشخصي';
        });
    };

    // --- Advanced Profile Card Logic ---
    window.showUserProfile = async (username) => {
        try {
            // Try to find user in local list first for speed
            let userData = null;
            const res = await fetch('/api/users'); // Refresh to get latest
            const users = await res.json();
            userData = users.find(u => u.username === username);

            if (!userData) {
                // Creates a mock object if not found (e.g. system bot)
                userData = { username, fullname: username, avatar: `https://ui-avatars.com/api/?name=${username}`, bio: 'مستخدم في راست كورد', level: 1, coins: 0, joined: Date.now(), role: 'member' };
            }

            // Populate Modal
            document.getElementById('profile-fullname').innerText = userData.fullname || userData.username;
            document.getElementById('profile-username').innerText = `@${userData.username}`;
            document.getElementById('profile-bio').innerText = userData.bio || 'لا توجد نبذة شخصية.';
            document.getElementById('profile-avatar-img').src = userData.avatar || `https://ui-avatars.com/api/?name=${username}`;

            // Status Indicator
            const statusEl = document.getElementById('profile-status-indicator');
            statusEl.className = `profile-status ${((Date.now() - (userData.lastSeen || 0)) < 15000) ? (userData.status || 'online') : 'offline'}`;

            // Stats
            document.getElementById('profile-level').innerText = userData.level || 1;
            document.getElementById('profile-coins').innerText = userData.coins || 0;
            document.getElementById('profile-joined').innerText = new Date(userData.joined || Date.now()).getFullYear();

            // Badges
            const badgeContainer = document.getElementById('profile-badges');
            badgeContainer.innerHTML = '';

            // Role Badges
            const role = getRoleClass(userData.username);
            if (role === 'role-owner') badgeContainer.innerHTML += `<div class="profile-badge-icon" title="المطور"><i class="fas fa-code"></i></div>`;
            if (role === 'role-admin') badgeContainer.innerHTML += `<div class="profile-badge-icon" title="إدارة"><i class="fas fa-shield-alt"></i></div>`;
            if (userData.isVerified) badgeContainer.innerHTML += `<div class="profile-badge-icon" title="موثوق" style="background:#3ba55c"><i class="fas fa-check"></i></div>`;

            // Actions
            document.getElementById('profile-msg-btn').onclick = () => {
                document.getElementById('profile-modal').style.display = 'none';
                window.openDM(userData.username);
            };

            // Admin Actions
            const adminActions = document.getElementById('profile-admin-actions');
            if (isAdmin && userData.username !== myUsername) {
                adminActions.style.display = 'flex';
                adminActions.innerHTML = `
                    <button class="btn-danger" onclick="window.adminAction('kick', '${userData.username}')">Kick</button>
                    <button class="btn-danger" onclick="window.adminAction('ban', '${userData.username}')">Ban</button>
                `;
            } else {
                adminActions.style.display = 'none';
            }

            document.getElementById('profile-modal').style.display = 'flex';
        } catch (e) { console.error(e); }
    };
});
