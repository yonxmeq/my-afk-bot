require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
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

const DATA_FILE = path.join(__dirname, 'last_channel.json');

// ฟังก์ชันสำหรับเชื่อมต่อ Voice Channel
function connectToChannel(channel) {
    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: false,
    });

    // บันทึก Channel ID ไว้ในไฟล์ json
    fs.writeFileSync(DATA_FILE, JSON.stringify({
        guildId: channel.guild.id,
        channelId: channel.id
    }));

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
            setTimeout(() => connectToChannel(channel), 5000);
        }
    });

    return connection;
}

client.once('ready', async () => {
    console.log(`✅ บอท ${client.user.tag} พร้อมทำงานแล้ว !`);

    // ตรวจสอบว่าเคยเข้าห้องไหนค้างไว้ไหม หากรีสตาร์ทจะเข้าห้องเดิมทันที
    if (fs.existsSync(DATA_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            const guild = await client.guilds.fetch(data.guildId);
            const channel = await guild.channels.fetch(data.channelId);

            if (channel) {
                console.log(`🔄 บอทรีกระทันหัน กำลังกลับเข้าห้อง: ${channel.name}`);
                connectToChannel(channel);
            }
        } catch (err) {
            console.error('❌ ไม่สามารถเข้าห้องเดิมอัตโนมัติได้:', err.message);
        }
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!stay') {
        const voiceChannel = message.member?.voice.channel;
        if (!voiceChannel) {
            return message.reply('❌ นายต้องเข้าไปอยู่ในห้องเสียงก่อนนะ!');
        }

        connectToChannel(voiceChannel);
        message.reply(`✅ เข้าไปสแตนด์บายในห้อง **${voiceChannel.name}**`);
    }
});

client.login(process.env.DISCORD_TOKEN);