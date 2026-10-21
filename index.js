require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    AudioPlayerStatus, 
    VoiceConnectionStatus, 
    entersState 
} = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// ไฟล์สำหรับบันทึกข้อมูล
const DATA_FILE = path.join(__dirname, 'last_channel.json');
const AFK_LOG_FILE = path.join(__dirname, 'afk_stats.json');

let currentConnection = null;
let audioPlayer = null;
let connectedTime = null; // บันทึกเวลาที่บอทเริ่มเข้าห้อง
const voiceTimeMap = new Map(); // บันทึกเวลาสมาชิกเข้าห้อง AFK

// ฟังก์ชันโหลดข้อมูลเวลา AFK ของสมาชิก
function loadAFKStats() {
    if (fs.existsSync(AFK_LOG_FILE)) {
        try { return JSON.parse(fs.readFileSync(AFK_LOG_FILE, 'utf8')); } 
        catch (e) { return {}; }
    }
    return {};
}

// ฟังก์ชันบันทึกเวลา AFK ของสมาชิก
function saveAFKStats(data) {
    fs.writeFileSync(AFK_LOG_FILE, JSON.stringify(data, null, 2));
}

// ฟังก์ชันเล่นเสียง Ambient / Lofi คลอเบาๆ
function playAmbientStream(connection) {
    if (!audioPlayer) {
        audioPlayer = createAudioPlayer();
    }
    // สตรีมมิ่ง Lofi Radio (Royalty Free 24/7)
    const streamUrl = 'https://stream.zeno.fm/f3wvbbqmdg8uv'; 
    const resource = createAudioResource(streamUrl, { inlineVolume: true });
    resource.volume?.setVolume(0.15); // ตั้งความดังไว้ที่ 15% (คลอเบาๆ)

    audioPlayer.play(resource);
    connection.subscribe(audioPlayer);

    audioPlayer.on(AudioPlayerStatus.Idle, () => {
        playAmbientStream(connection); // ให้เล่นวนซ้ำเมื่อสตรีมตัด
    });
}

// ฟังก์ชันเชื่อมต่อห้องเสียง
async function connectToChannel(channel, textChannel = null) {
    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false, // ปิด Deaf เพื่อให้บอทฟังเสียงสัญญาณในห้องได้ปกติ
        selfMute: false,
    });

    currentConnection = connection;
    connectedTime = new Date();

    // บันทึก Channel ID ไว้ในไฟล์ json
    fs.writeFileSync(DATA_FILE, JSON.stringify({
        guildId: channel.guild.id,
        channelId: channel.id,
        textChannelId: textChannel ? textChannel.id : null
    }));

    // เล่นเสียง Ambient คลอเบาๆ
    try {
        playAmbientStream(connection);
    } catch (e) {
        console.log('⚠️ ไม่สามารถเล่นเสียงAmbientได้:', e.message);
    }

    // ดักจับสถานะเน็ตหลุด ให้ลองต่อใหม่
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
            await Promise.race([
                entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
            ]);
        } catch (error) {
            console.log('⚠️ การเชื่อมต่อหลุด พยายามเชื่อมต่อใหม่...');
            connection.destroy();
            setTimeout(() => connectToChannel(channel, textChannel), 5000);
        }
    });

    return connection;
}

client.once('ready', async () => {
    console.log(`✅  ${client.user.tag} พร้อมทำงานแล้ว`);

    // ตั้งค่า Rich Presence
    client.user.setPresence({
        activities: [{ name: 'Streaming @xShaneKaru | !stay', type: ActivityType.Streaming, url: 'https://www.youtube.com/@xShaneKaru' }],
        status: 'online',
    });

    // ระบบ Auto Reconnect เมื่อเซิร์ฟเวอร์รีบูต
    if (fs.existsSync(DATA_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            const guild = await client.guilds.fetch(data.guildId);
            const channel = await guild.channels.fetch(data.channelId);

            if (channel) {
                console.log(`🔄 เค้ารีตัวและกำลังกลับเข้าห้อง: ${channel.name}`);
                let textChan = null;
                if (data.textChannelId) {
                    textChan = await guild.channels.fetch(data.textChannelId).catch(() => null);
                }
                
                await connectToChannel(channel, textChan);

                // แจ้งเตือนลง Log Channel เมื่อออโต้รีคอนเนกต์สำเร็จ
                if (textChan) {
                    textChan.send(`⚡ **[Auto Reconnect Log]** เค้ากลับมาในห้อง **${channel.name}** และอ้วมม`);
                }
            }
        } catch (err) {
            console.error('❌ ไม่สามารถเข้าห้องเดิมอัตโนมัติได้:', err.message);
        }
    }
});

// ระบบนับเวลาสแตนด์บาย AFK ของสมาชิก
client.on('voiceStateUpdate', (oldState, newState) => {
    if (newState.member.user.bot) return;

    if (fs.existsSync(DATA_FILE)) {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        
        // เข้ามาห้องเดียวกับบอท
        if (newState.channelId === data.channelId && oldState.channelId !== data.channelId) {
            voiceTimeMap.set(newState.member.id, Date.now());
        }

        // ออกจากห้องบอท -> คำนวณเวลาและสะสมลงไฟล์
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

// คำสั่งจัดการบอท
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const command = message.content.toLowerCase().split(' ')[0];

    // คำสั่ง !stay หรือ !come (สั่งให้บอทเข้า/ตามมาห้องเสียง)
    if (command === '!stay' || command === '!come') {
        const voiceChannel = message.member?.voice.channel;
        if (!voiceChannel) {
            return message.reply('❌ คุณต้องเข้าไปอยู่ในห้องเสียงก่อนนะ');
        }

        await connectToChannel(voiceChannel, message.channel);
        message.reply(`✅ เข้าประจำการในห้อง **${voiceChannel.name}**แน้วกั๊บบ`);
    }

    // คำสั่ง !leave (สั่งให้บอทออกจากห้องเสียง)
    if (command === '!leave') {
        if (currentConnection) {
            currentConnection.destroy();
            currentConnection = null;
            if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE);
            message.reply('👋 ออกจากห้องเสียงเรียบร้อยละ บัยบุยย!');
        } else {
            message.reply('❌ เค้าไม่ได้อยู่ในห้องเสียงค่ะ!');
        }
    }

    // คำสั่ง !status (เช็กสถิติเวลาสแตนด์บายของบอท)
    if (command === '!status') {
        if (!connectedTime || !currentConnection) {
            return message.reply('ℹ️ เค้าไม่ได้อยู่ในห้องเสียงขณะนี้ค่ะ');
        }

        const now = new Date();
        const diffMs = now - connectedTime;
        const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

        message.reply(`📊 **สถานะบอทShane:**\n• สู้รบต่อเนื่องมาแล้ว: **${diffHrs} ชั่วโมง ${diffMins} นาที**\n• สถานะเสียง Ambient: **กำลังเล่นคลอเบาๆ** 🎶`);
    }

    // คำสั่ง !afkstats (เช็กเวลาสะสม AFK ของตัวเอง)
    if (command === '!afkstats') {
        const stats = loadAFKStats();
        const userMinutes = stats[message.author.id] || 0;
        const userHours = (userMinutes / 60).toFixed(1);

        message.reply(`⏱️ **สถิติเวลาAFKของคุณ:**\nสะสมเวลารวมทั้งหมด: **${userHours} ชั่วโมง** (${userMinutes} นาที)`);
    }
});

client.login(process.env.DISCORD_TOKEN);