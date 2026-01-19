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
        servers: [
            { id: 'rust-main', name: 'Rust Cord Main', icon: '🛠', channels: [{ id: 'general', name: 'العام', type: 'text' }, { id: 'voice-1', name: 'ديوانية', type: 'voice' }] }
        ]
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2));
}

const getDB = () => JSON.parse(fs.readFileSync(DB_FILE));
const saveDB = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

app.get('/api/messages', (req, res) => res.json(getDB().messages));

app.post('/api/messages', (req, res) => {
    const { author, text, timestamp, imageUrl, replyTo, fileData, fileName } = req.body;
    const db = getDB();
    const newMessage = {
        id: Date.now(),
        author,
        text,
        timestamp: timestamp || new Date().toISOString(),
        imageUrl,
        replyTo,
        fileData,
        fileName,
        reactions: {},
        pinned: false
    };
    db.messages.push(newMessage);
    if (db.messages.length > 200) db.messages.shift();
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
    res.json({ success: true });
});

app.get('/api/users', (req, res) => {
    res.json(getDB().users.map(u => ({
        username: u.username, fullname: u.fullname, avatar: u.avatar,
        lastSeen: u.lastSeen, status: u.status, customStatus: u.customStatus
    })));
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
