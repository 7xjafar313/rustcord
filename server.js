const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

if (!fs.existsSync(DB_FILE)) {
    const defaultData = {
        messages: [],
        users: [],
        dms: [],
        bannedUsers: [],
        voiceStates: [],
        announcement: { text: 'مرحباً بكم في راست كورد v3! 🚀', active: true },
        servers: [
            { id: 'rust-main', name: 'Rust Cord Main', icon: '🛠', channels: [{ id: 'general', name: 'العام', type: 'text' }, { id: 'voice-1', name: 'ديوانية', type: 'voice' }, { id: 'voice-2', name: 'لعب', type: 'voice' }] }
        ],
        shopItems: [
            { id: 'role-vip', name: 'VIP Role', price: 1000, type: 'role', color: '#f1c40f' },
            { id: 'role-pro', name: 'Pro Member', price: 500, type: 'role', color: '#e74c3c' }
        ]
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2));
}

// --- Telegram Persistence Logic ---
const TG_BOT_TOKEN = '6780979570:AAEpS358Uxk_FuegiXu80-ElfxnVFE_AQrU';
const TG_CHAT_ID = '1680454327';
let lastBackupTime = 0;

async function restoreFromTelegram() {
    try {
        console.log('Restoring from Telegram...');
        const chatRes = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/getChat?chat_id=${TG_CHAT_ID}`);
        const chatData = await chatRes.json();

        if (chatData.ok && chatData.result.pinned_message && chatData.result.pinned_message.document) {
            const doc = chatData.result.pinned_message.document;
            const fileRes = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/getFile?file_id=${doc.file_id}`);
            const fileData = await fileRes.json();

            if (fileData.ok) {
                const dbContentRes = await fetch(`https://api.telegram.org/file/bot${TG_BOT_TOKEN}/${fileData.result.file_path}`);
                const dbContent = await dbContentRes.text();
                fs.writeFileSync(DB_FILE, dbContent);
                console.log('Database restored successfully from Telegram!');
            }
        } else {
            console.log('No backup found or pinned.');
        }
    } catch (e) { console.error('Restore failed:', e); }
}

async function backupToTelegram() {
    if (Date.now() - lastBackupTime < 10000) return; // Debounce 10s
    lastBackupTime = Date.now();

    try {
        const formData = new FormData();
        formData.append('chat_id', TG_CHAT_ID);
        formData.append('document', new Blob([fs.readFileSync(DB_FILE)], { type: 'application/json' }), 'database.json');

        const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendDocument`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();

        if (data.ok) {
            // Pin the message to make it easy to find later
            await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/pinChatMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: TG_CHAT_ID, message_id: data.result.message_id })
            });
        }
    } catch (e) { console.error('Backup failed:', e); }
}

// Restore on start
restoreFromTelegram().then(() => {
    if (!fs.existsSync(DB_FILE)) {
        // ... (Default init logic if restore failed/empty)
    }
});

const getDB = () => {
    if (!fs.existsSync(DB_FILE)) return {}; // Safety
    return JSON.parse(fs.readFileSync(DB_FILE));
};
const saveDB = (db) => {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    backupToTelegram(); // Async backup
};

app.get('/api/messages', (req, res) => {
    const { channelId } = req.query;
    const db = getDB();
    if (channelId) {
        // Filter messages by channel
        const filtered = db.messages.filter(m => m.channelId === channelId || (!m.channelId && channelId === 'general'));
        res.json(filtered);
    } else {
        res.json(db.messages);
    }
});

app.post('/api/messages', (req, res) => {
    const { author, text, timestamp, imageUrl, replyTo, fileData, fileName, channelId } = req.body;
    const db = getDB();
    const newMessage = {
        id: Date.now(),
        author,
        text,
        channelId: channelId || 'general',
        timestamp: timestamp || new Date().toISOString(),
        imageUrl,
        replyTo,
        fileData,
        fileName,
        reactions: {},
        pinned: false
    };

    // XP & Coin System
    const user = db.users.find(u => u.username === author);
    if (user) {
        user.xp = (user.xp || 0) + 10;
        user.coins = (user.coins || 0) + 5;
        user.level = Math.floor(user.xp / 100) + 1;
    }

    db.messages.push(newMessage);
    // Keep more messages since we are splitting by channel now (limit per channel maybe? stick to global limit for now but increased)
    if (db.messages.length > 1000) db.messages.shift();
    saveDB(db);
    res.status(201).json(newMessage);
});

app.delete('/api/messages/:id', (req, res) => {
    const db = getDB();
    db.messages = db.messages.filter(m => m.id != req.params.id);
    saveDB(db);
    res.json({ success: true });
});

app.put('/api/messages/:id', (req, res) => {
    const { text, pinned, reaction, username } = req.body;
    const db = getDB();
    const msg = db.messages.find(m => m.id == req.params.id);
    if (msg) {
        if (text !== undefined) { msg.text = text; msg.edited = true; }
        if (pinned !== undefined) msg.pinned = pinned;
        if (reaction && username) {
            if (!msg.reactions[reaction]) msg.reactions[reaction] = [];
            if (msg.reactions[reaction].includes(username)) {
                msg.reactions[reaction] = msg.reactions[reaction].filter(u => u !== username);
                if (msg.reactions[reaction].length === 0) delete msg.reactions[reaction];
            } else {
                msg.reactions[reaction].push(username);
            }
        }
        saveDB(db);
        res.json(msg);
    } else res.status(404).json({ error: 'Not found' });
});

app.post('/api/heartbeat', (req, res) => {
    const { username, status, customStatus } = req.body;
    if (!username) return res.status(400).json({ success: false });
    const db = getDB();
    const user = db.users.find(u => u.username === username);
    if (user) {
        user.lastSeen = Date.now();
        if (status) user.status = status;
        if (customStatus !== undefined) user.customStatus = customStatus;
        saveDB(db);
    }
    // Also update voice heartbeat if user is in voice
    if (db.voiceStates) {
        const vState = db.voiceStates.find(v => v.username === username);
        if (vState) vState.lastSeen = Date.now();
        saveDB(db); // Save again if changed
    }
    res.json({ success: true });
});

app.get('/api/users', (req, res) => {
    res.json(getDB().users.map(u => ({
        username: u.username, fullname: u.fullname, avatar: u.avatar,
        lastSeen: u.lastSeen, status: u.status, customStatus: u.customStatus
    })));
});

// Voice State Management
app.get('/api/voice-states', (req, res) => {
    const db = getDB();
    // Filter out stale voice users (timeout > 30s)
    if (db.voiceStates) {
        const now = Date.now();
        const activeStates = db.voiceStates.filter(v => (now - v.lastSeen) < 30000);
        if (activeStates.length !== db.voiceStates.length) {
            db.voiceStates = activeStates;
            saveDB(db);
        }
        res.json(db.voiceStates);
    } else {
        res.json([]);
    }
});

app.post('/api/voice/join', (req, res) => {
    const { username, channelId, peerId, avatar } = req.body;
    const db = getDB();
    if (!db.voiceStates) db.voiceStates = [];

    // Remove if already exists elsewhere
    db.voiceStates = db.voiceStates.filter(v => v.username !== username);

    db.voiceStates.push({
        username,
        channelId,
        peerId,
        avatar,
        lastSeen: Date.now()
    });

    saveDB(db);
    res.json({ success: true });
});

app.post('/api/voice/leave', (req, res) => {
    const { username } = req.body;
    const db = getDB();
    if (db.voiceStates) {
        db.voiceStates = db.voiceStates.filter(v => v.username !== username);
        saveDB(db);
    }
    res.json({ success: true });
});

app.get('/api/servers', (req, res) => res.json(getDB().servers || []));

app.post('/api/servers', (req, res) => {
    const { name, icon } = req.body;
    const db = getDB();
    if (!db.servers) db.servers = [];
    const newServer = { id: Date.now().toString(), name, icon, channels: [{ id: 'general', name: 'العام', type: 'text' }] };
    db.servers.push(newServer);
    saveDB(db);
    res.json(newServer);
});

app.post('/api/servers/:id/channels', (req, res) => {
    const { name, type } = req.body;
    const db = getDB();
    const server = db.servers.find(s => s.id === req.params.id);
    if (server) {
        const newChannel = { id: Date.now().toString(), name, type };
        server.channels.push(newChannel);
        saveDB(db);
        res.json(newChannel);
    } else res.status(404).json({ error: 'Server not found' });
});

app.post('/api/sync-users', (req, res) => {
    const { users } = req.body;
    const db = getDB();
    db.users = users;
    saveDB(db);
    res.json({ success: true });
});

app.get('/api/sync-users', (req, res) => res.json(getDB().users));

// API: Telegram Audio Proxy
// DM System
app.post('/api/dms', (req, res) => {
    const { from, to, text } = req.body;
    const db = getDB();
    if (!db.dms) db.dms = [];
    const newDm = { id: Date.now(), from, to, text, timestamp: new Date().toISOString() };
    db.dms.push(newDm);
    saveDB(db);
    res.json(newDm);
});

app.get('/api/dms/:u1/:u2', (req, res) => {
    const { u1, u2 } = req.params;
    const db = getDB();
    const chat = (db.dms || []).filter(d => (d.from === u1 && d.to === u2) || (d.from === u2 && d.to === u1));
    res.json(chat);
});

// Shop System
app.get('/api/shop', (req, res) => res.json(getDB().shopItems || []));
app.post('/api/shop/buy', (req, res) => {
    const { username, itemId } = req.body;
    const db = getDB();
    const user = db.users.find(u => u.username === username);
    const item = db.shopItems.find(i => i.id === itemId);
    if (user && item && user.coins >= item.price) {
        user.coins -= item.price;
        if (!user.roles) user.roles = [];
        user.roles.push(item.id);
        saveDB(db);
        res.json({ success: true, user });
    } else res.status(400).json({ error: 'Balance or item error' });
});

// Admin System
app.post('/api/admin/kick', (req, res) => {
    const { username } = req.body;
    // For simplicity, we just notify client. In real app, we'd disconnect socket.
    res.json({ success: true, message: `Kicked ${username}` });
});

app.post('/api/admin/ban', (req, res) => {
    const { username } = req.body;
    const db = getDB();
    if (!db.bannedUsers) db.bannedUsers = [];
    db.bannedUsers.push(username);
    saveDB(db);
    res.json({ success: true });
});

// Announcement System
app.get('/api/announcement', (req, res) => res.json(getDB().announcement || {}));
app.post('/api/announcement', (req, res) => {
    const { text, active } = req.body;
    const db = getDB();
    db.announcement = { text, active };
    saveDB(db);
    res.json(db.announcement);
});

// Smart Link Preview Proxy
app.get('/api/link-preview', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL required');
    try {
        const response = await fetch(url);
        const html = await response.text();
        const title = html.match(/<title>(.*?)<\/title>/)?.[1] || '';
        const desc = html.match(/meta name="description" content="(.*?)"/)?.[1] || '';
        const img = html.match(/meta property="og:image" content="(.*?)"/)?.[1] || '';
        res.json({ title, desc, img, url });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tg-audio/:fileId', async (req, res) => {
    const BOT_TOKEN = '6780979570:AAEpS358Uxk_FuegiXu80-ElfxnVFE_AQrU';
    try {
        const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${req.params.fileId}`);
        const fileData = await fileRes.json();
        if (fileData.ok) {
            const filePath = fileData.result.file_path;
            const finalUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
            res.redirect(finalUrl);
        } else res.status(404).json({ error: 'File not found' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`Rust Cord v2 running on http://localhost:${PORT}`));
