require('dotenv').config();
const { Telegraf } = require('telegraf');
const fs = require('fs');
const cron = require('node-cron');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const timezone = require('dayjs/plugin/timezone');
const utc = require('dayjs/plugin/utc');

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

dayjs.tz.setDefault('Asia/Tashkent');

const bot = new Telegraf(process.env.BOT_TOKEN);
const DB_FILE = './db.json';
const USERS_FILE = './users.json';

// DB o'qish va yozish funksiyalari (Postlar)
const readDB = () => {
    try {
        if (!fs.existsSync(DB_FILE)) {
            fs.writeFileSync(DB_FILE, JSON.stringify([]));
        }
        const data = fs.readFileSync(DB_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error("DB o'qishda xatolik:", error);
        return [];
    }
};

const writeDB = (data) => {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("DB yozishda xatolik:", error);
    }
};

// Users o'qish va yozish funksiyalari
const readUsers = () => {
    try {
        if (!fs.existsSync(USERS_FILE)) {
            fs.writeFileSync(USERS_FILE, JSON.stringify({}));
        }
        return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    } catch (error) {
        console.error("Users db o'qishda xatolik:", error);
        return {};
    }
};

const writeUsers = (data) => {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("Users db yozishda xatolik:", error);
    }
};

const getUser = (userId) => {
    const users = readUsers();
    return users[userId] || {};
};

const updateUser = (userId, data) => {
    const users = readUsers();
    if (!users[userId]) users[userId] = {};
    users[userId] = { ...users[userId], ...data };
    writeUsers(users);
};

const getOwnerByChannelId = (chatId) => {
    const users = readUsers();
    for (const [userId, data] of Object.entries(users)) {
        if (data.chat_id === chatId) {
            return userId;
        }
    }
    return null;
};

// Start buyrug'i
bot.start((ctx) => {
    ctx.reply("Botdan foydalanish uchun kanal yoki gruppaga botni admin qilib qo‘shing", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "➕ Kanal/Grupa ulash", callback_data: "connect_channel" }]
            ]
        }
    });
});

// Kanal ulash tugmasi
bot.action('connect_channel', async (ctx) => {
    const userId = ctx.from.id.toString();
    updateUser(userId, { state: 'WAITING_FOR_CHANNEL' });
    await ctx.answerCbQuery();
    await ctx.reply("1. Botni kanal yoki gruppaga admin qiling\n2. Shu yerga kanal username yoki group ID yuboring");
});

// Shaxsiy xabarlarni tutish (Kanal ID kiritish uchun)
bot.on('message', async (ctx, next) => {
    if (ctx.chat.type === 'private' && ctx.message.text) {
        const userId = ctx.from.id.toString();
        const user = getUser(userId);
        
        if (user.state === 'WAITING_FOR_CHANNEL') {
            const channelId = ctx.message.text.trim();
            try {
                // Kanal/Gruppa ID sini tekshiramiz
                const chat = await ctx.telegram.getChat(channelId);
                const member = await ctx.telegram.getChatMember(chat.id, ctx.botInfo.id);
                
                if (member.status === 'administrator' || member.status === 'creator') {
                    updateUser(userId, { chat_id: chat.id.toString(), state: 'NONE' });
                    await ctx.reply("✅ Kanal yoki Gruppa muvaffaqiyatli ulandi!");
                } else {
                    await ctx.reply("❌ Bot kanal yoki gruppada admin emas. Admin qilib qayta urinib ko'ring.");
                }
            } catch (error) {
                console.error(error.message);
                await ctx.reply("❌ Kanal yoki Gruppa topilmadi yoki bot u yerda yo'q. ID yoki username to'g'riligini tekshiring.");
            }
            return;
        }
    }
    return next();
});

// Postlarni tutish
const handlePost = async (ctx) => {
    try {
        const message = ctx.message || ctx.channelPost;
        if (!message) return;

        // Faqat kanal yoki gruppalardan kelgan postlarni qabul qilish
        if (ctx.chat.type === 'private') return;

        const chatId = ctx.chat.id.toString();
        const ownerUserId = getOwnerByChannelId(chatId);

        // Agar bu kanal hech qaysi userga ulanmagan bo'lsa, e'tibor bermaymiz
        if (!ownerUserId) return;

        // Faqat rasmli xabarlarni qabul qilish
        if (!message.photo) return;

        const caption = message.caption || '';
        
        // Sana va vaqtni izlash (Format: DD.MM.YYYY HH:mm)
        const dateTimeRegex = /(\d{2}\.\d{2}\.\d{4}\s\d{2}:\d{2})/;
        const match = caption.match(dateTimeRegex);

        if (match) {
            const dateTimeStr = match[1];
            const parsedDate = dayjs.tz(dateTimeStr, 'DD.MM.YYYY HH:mm', 'Asia/Tashkent');

            if (!parsedDate.isValid()) {
                console.log("Xato vaqt formati:", dateTimeStr);
                try {
                    await ctx.reply(`❌ Sana yoki vaqt xato kiritildi: ${dateTimeStr}\nIltimos tekshirib qaytadan yozing.`);
                } catch (e) {}
                return;
            }

            const fileId = message.photo[message.photo.length - 1].file_id; // Eng katta razmerdagi rasm

            const newPost = {
                user_id: ownerUserId,
                chat_id: chatId,
                file_id: fileId,
                caption: caption,
                datetime: parsedDate.toISOString(),
                original_datetime_str: dateTimeStr,
                status: 'pending'
            };

            const db = readDB();
            db.push(newPost);
            writeDB(db);

            console.log(`Saqlanmoqda: Rasm (${fileId}) ${dateTimeStr} uchun belgilandi.`);

            try {
                await ctx.reply(`✅ Saqlandi, belgilangan vaqtda yuboriladi`);
            } catch (replyError) {
                console.error("Javob yuborishda xatolik:", replyError.message);
            }
        }
    } catch (error) {
        console.error("Postni qayta ishlashda xatolik:", error);
    }
};

bot.on('channel_post', handlePost);
bot.on('message', handlePost);

// Scheduler: Har 1 daqiqada tekshiradi
cron.schedule('* * * * *', async () => {
    console.log("Scheduler ishladi...", dayjs().tz('Asia/Tashkent').format('DD.MM.YYYY HH:mm'));

    const db = readDB();
    let hasChanges = false;
    const now = dayjs().tz('Asia/Tashkent');

    for (const post of db) {
        if (post.status === 'pending') {
            const postTime = dayjs(post.datetime).tz('Asia/Tashkent');

            if (now.isAfter(postTime) || now.isSame(postTime, 'minute')) {
                try {
                    // Xabarni shu kanalni ulagan userga yuboramiz
                    await bot.telegram.sendPhoto(post.user_id, post.file_id, {
                        caption: post.caption
                    });
                    console.log(`Userga (${post.user_id}) yuborildi: Rasm (${post.file_id}) ${post.original_datetime_str} da.`);
                    post.status = 'sent';
                    hasChanges = true;
                } catch (error) {
                    console.error(`Post yuborishda xatolik (${post.file_id}):`, error.message);
                    post.status = 'error';
                    hasChanges = true;
                }
            }
        }
    }

    if (hasChanges) {
        writeDB(db);
    }
});

const http = require('http');
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot ishlamoqda...');
});

server.listen(PORT, () => {
    console.log(`Web server port ${PORT} da ishga tushdi. (Render uchun)`);
});

bot.launch().then(() => {
    console.log('Bot ishga tushdi!');
}).catch(console.error);

// Enable graceful stop
process.once('SIGINT', () => { bot.stop('SIGINT'); server.close(); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); server.close(); });
