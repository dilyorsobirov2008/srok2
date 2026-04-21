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

// Target User ID .env dan olinadi
const TARGET_USER_ID = process.env.TARGET_USER_ID;

// DB o'qish va yozish funksiyalari
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

// Postlarni ushlash funksiyasi
const handlePost = async (ctx) => {
    try {
        const message = ctx.message || ctx.channelPost;

        if (!message || !message.photo) return; // Faqat rasmli postlar

        const caption = message.caption || '';

        // Sana va vaqtni izlash (Format: DD.MM.YYYY HH:mm)
        // \d{2}\.\d{2}\.\d{4} -> Sana, \d{2}:\d{2} -> Vaqt
        const dateTimeRegex = /(\d{2}\.\d{2}\.\d{4}\s\d{2}:\d{2})/;
        const match = caption.match(dateTimeRegex);

        if (match) {
            const dateTimeStr = match[1];

            // Vaqtni to'g'ri O'zbekiston vaqtida ekanligini tekshiramiz
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

            // Javob yozish
            // Agar channel post bo'lsa, kanalga xabar yubora olamiz (faqat agar ruxsat bo'lsa)
            try {
                await ctx.reply(`✅ Saqlandi, ${dateTimeStr} da userga yuboriladi`);
            } catch (replyError) {
                console.error("Javob yuborishda xatolik (Kanalga xabar yozish ruxsati yo'q bo'lishi mumkin):", replyError.message);
            }
        } else {
            // Agar sana va vaqt topilmasa, o'rgatuvchi xabar yuboramiz
            try {
                await ctx.reply("❌ Xato: Rasm ostida sana va vaqt topilmadi yoki noto'g'ri yozilgan.\n\nTo'g'ri format quyidagicha bo'lishi kerak:\n\n[Tovar haqida ma'lumot]\nDD.MM.YYYY HH:mm\n\nMasalan:\nYangi tovar\n25.04.2026 15:30");
            } catch (replyError) {
                console.error("O'rgatuvchi xabar yuborishda xatolik:", replyError.message);
            }
        }
    } catch (error) {
        console.error("Postni qayta ishlashda xatolik:", error);
    }
};

bot.on('message', handlePost);
bot.on('channel_post', handlePost);

// Scheduler: Har 1 daqiqada tekshiradi
cron.schedule('* * * * *', async () => {
    console.log("Scheduler ishladi...", dayjs().tz('Asia/Tashkent').format('DD.MM.YYYY HH:mm'));

    if (!TARGET_USER_ID) {
        console.log("TARGET_USER_ID ko'rsatilmagan! .env faylni tekshiring.");
        return;
    }

    const db = readDB();
    let hasChanges = false;
    const now = dayjs().tz('Asia/Tashkent');

    for (const post of db) {
        if (post.status === 'pending') {
            const postTime = dayjs(post.datetime).tz('Asia/Tashkent');

            if (now.isAfter(postTime) || now.isSame(postTime, 'minute')) {
                try {
                    await bot.telegram.sendPhoto(TARGET_USER_ID, post.file_id, {
                        caption: post.caption
                    });
                    console.log(`Userga yuborildi: Rasm (${post.file_id}) ${post.original_datetime_str} da.`);
                    post.status = 'sent';
                    hasChanges = true;
                } catch (error) {
                    console.error(`Post yuborishda xatolik (${post.file_id}):`, error.message);
                    // Agar bloklangan yoki chat topilmasa, keyinchalik xatolik bermasligi uchun bekor qilamiz
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
