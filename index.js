require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { 
    joinVoiceChannel, 
    VoiceConnectionStatus, 
    entersState 
} = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ==========================================
// [ระบบ Keep-Alive] ป้องกัน Render หลับ
// ==========================================
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ShaneBot 24/7 Pure AFK Service is Active!');
}).listen(PORT, () => {
    console.log(`🌐 Keep-Alive Server running on port ${PORT}`);
});

// ==========================================
// [ระบบป้องกัน Crash] ดักจับ Error ทั้งหมด
// ==========================================
process.on('uncaughtException', (err) => {
    console.error('⚠️ [Uncaught Exception Error]:', err.message);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ [Unhandled Rejection Error]:', reason);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

const DATA_FILE = path.join(__dirname, 'last_channel.json');
const AFK_LOG_FILE = path.join(__dirname, 'afk_stats.json');

let currentConnection = null;
let connectedTime = null;
const voiceTimeMap = new Map();

function loadAFKStats() {
    if (fs.existsSync(AFK_LOG_FILE)) {
        try { return JSON.parse(fs.readFileSync(AFK_LOG_FILE, 'utf8')); } 
        catch (e) { return {}; }
    }
    return {};
}

function saveAFKStats(data) {
    fs.writeFileSync(AFK_LOG_FILE, JSON.stringify(data, null, 2));
}

// ==========================================
// [ระบบเชื่อมต่อห้องเสียงแบบนิ่งๆ 24/7]
// ==========================================
async function connectToChannel(channel, textChannel = null) {
    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: true, // ปิดไมค์บอทไว้นิ่งๆ ไม่ส่งเสียง
    });

    currentConnection = connection;
    connectedTime = new Date();

    fs.writeFileSync(DATA_FILE, JSON.stringify({
        guildId: channel.guild.id,
        channelId: channel.id,
        textChannelId: textChannel ? textChannel.id : null
    }));

    // ระบบต่อสายอัตโนมัติทันทีถ้าเน็ตหลุด
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
            await Promise.race([
                entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
            ]);
        } catch (error) {
            console.log('⚠️ สัญญาณหลุด กำลังเชื่อมต่อกลับเข้าห้องเสียงใหม่ใน 5 วินาที...');
            connection.destroy();
            setTimeout(() => connectToChannel(channel, textChannel), 5000);
        }
    });

    return connection;
}

client.once('ready', async () => {
    console.log(`✅ บอท ${client.user.tag} พร้อมสแตนด์บาย 24/7 แล้ว!`);

    client.user.setPresence({
        activities: [{ name: '24/7 Voice AFK | !stay', type: ActivityType.Streaming, url: 'https://www.youtube.com/@xShaneKaru' }],
        status: 'online',
    });

    // ยิง Ping ตัวเองทุกๆ 5 นาที
    setInterval(() => {
        const url = process.env.RENDER_EXTERNAL_URL;
        if (url) {
            http.get(url, (res) => {
                console.log(`📡 Keep-Alive Ping Status: ${res.statusCode}`);
            }).on('error', (err) => {
                console.error('⚠️ Keep-Alive Ping Failed:', err.message);
            });
        }
    }, 5 * 60 * 1000);

    // ฟื้นคืนชีพเข้าห้องเดิมอัตโนมัติหลังรีบูต
    if (fs.existsSync(DATA_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            const guild = await client.guilds.fetch(data.guildId);
            const channel = await guild.channels.fetch(data.channelId);

            if (channel) {
                console.log(`🔄 บอทกำลังกลับเข้าห้องเดิม: ${channel.name}`);
                let textChan = null;
                if (data.textChannelId) {
                    textChan = await guild.channels.fetch(data.textChannelId).catch(() => null);
                }
                
                await connectToChannel(channel, textChan);

                if (textChan) {
                    textChan.send(`⚡ บอทกลับมาสแตนด์บายในห้อง **${channel.name}** เรียบร้อยครับ!`);
                }
            }
        } catch (err) {
            console.error('❌ ไม่สามารถเข้าห้องเดิมอัตโนมัติได้:', err.message);
        }
    }
});

// นับเวลา AFK ให้สมาชิกที่เข้ามานั่งด้วย
client.on('voiceStateUpdate', (oldState, newState) => {
    if (newState.member.user.bot) return;

    if (fs.existsSync(DATA_FILE)) {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        
        if (newState.channelId === data.channelId && oldState.channelId !== data.channelId) {
            voiceTimeMap.set(newState.member.id, Date.now());
        }

        if (oldState.channelId === data.channelId && newState.channelId !== data.channelId) {
            const joinTime = voiceTimeMap.get(oldState.member.id);
            if (joinTime) {
                const durationMinutes = Math.floor((Date.now() - joinTime) / 1000 / 60);
                voiceTimeMap.delete(oldState.member.id);

                if (durationMinutes > 0) {
                    const stats = loadAFKStats();
                    stats[oldState.member.id] = (stats[oldState.member.id] || 0) + durationMinutes;
                    saveAFKStats(stats);
                }
            }
        }
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const command = message.content.toLowerCase().split(' ')[0];

    if (command === '!stay' || command === '!come') {
        const voiceChannel = message.member?.voice.channel;
        if (!voiceChannel) {
            return message.reply('❌ นายต้องเข้าไปอยู่ในห้องเสียงก่อนนะ!');
        }

        await connectToChannel(voiceChannel, message.channel);
        message.reply(`✅ เข้าประจำการสแตนด์บายในห้อง **${voiceChannel.name}** แบบนิ่งๆ 24/7 เรียบร้อย!`);
    }

    if (command === '!leave') {
        if (currentConnection) {
            currentConnection.destroy();
            currentConnection = null;
            if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE);
            message.reply('👋 ออกจากห้องเสียงเรียบร้อยแล้วครับ!');
        } else {
            message.reply('❌ บอทไม่ได้อยู่ในห้องเสียงครับ!');
        }
    }

    if (command === '!status') {
        if (!connectedTime || !currentConnection) {
            return message.reply('ℹ️ บอทไม่ได้สแตนด์บายอยู่ในห้องเสียงขณะนี้ครับ');
        }

        const now = new Date();
        const diffMs = now - connectedTime;
        const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

        message.reply(`📊 **สถานะ ShaneBot:**\n• สแตนด์บายต่อเนื่องมาแล้ว: **${diffHrs} ชั่วโมง ${diffMins} นาที**\n• สถานะระบบ: **ออนไลน์ 24/7 (Pure AFK)** 🟢`);
    }

    if (command === '!afkstats') {
        const stats = loadAFKStats();
        const userMinutes = stats[message.author.id] || 0;
        const userHours = (userMinutes / 60).toFixed(1);

        message.reply(`⏱️ **สถิติเวลา AFK ของคุณ:**\nสะสมเวลาสแตนด์บายรวมทั้งหมด: **${userHours} ชั่วโมง** (${userMinutes} นาที)`);
    }
});

client.login(process.env.DISCORD_TOKEN);