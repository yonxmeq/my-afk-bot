require('dotenv').config(); // <--- เพิ่มบรรทัดนี้ไว้บนสุด

const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, VoiceConnectionStatus, entersState } = require('@discordjs/voice');


const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ฟังก์ชันสั่งให้บอทเข้าและเชื่อมต่อให้อัตโนมัติหากสัญญาณหลุด
async function connectToChannel(channel) {
    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: true, // ปิดหูบอท
        selfMute: true  // ปิดไมค์บอท
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
            await Promise.race([
                entersState(connection, VoiceConnectionStatus.Signalling, 5000),
                entersState(connection, VoiceConnectionStatus.Connecting, 5000),
            ]);
        } catch (error) {
            connection.destroy();
            connectToChannel(channel);
        }
    });

    return connection;
}

client.once('ready', () => {
    console.log(`✅ บอท ${client.user.tag} พร้อมทำงานแล้ว!`);
});

client.on('messageCreate', async (message) => {
    if (message.content === '!stay') {
        const voiceChannel = message.member?.voice.channel;
        if (!voiceChannel) return message.reply('❌ คุณต้องอยู่ในห้องเสียงก่อนพิมพ์คำสั่งนะ!');
        
        await connectToChannel(voiceChannel);
        message.reply(`🎛️ เข้าประจำการในห้อง **${voiceChannel.name}** ยาวๆ แล้วครับ!`);
    }
});

// อ่าน Token จากระบบ Environment Variable
client.login(process.env.TOKEN);