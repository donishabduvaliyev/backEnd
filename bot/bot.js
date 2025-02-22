import TelegramBot from "node-telegram-bot-api";
import { existsSync, readFileSync, writeFileSync } from 'fs';
require('dotenv').config();
import { userInfo } from "os";




const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
    console.error("❌ Telegram Bot Token is missing in environment variables.");
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, {
    polling: {
        interval: 300, // Adjust polling interval
        autoStart: true,
    },
});

const options = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: "Salom", callback_data: "salom dedingiz" },
                { text: "Xayr", callback_data: "xayr dedingiz" }
            ],
            [
                { text: "Visit Website", url: "https://test-web-site-template.netlify.app/" }
            ],
            [
                { text: "Share Contact", callback_data: "share_contact" }
            ]
        ]
    }
};

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "Hello! Welcome to the experimental bot.", options);
    console.log("New user:", msg.chat.id);
});

// ✅ Handle Inline Buttons
bot.on("callback_query", (msg) => {
    if (msg.data === "share_contact") {
        bot.sendMessage(msg.message.chat.id, "Please share your contact by tapping the button below.", {
            reply_markup: {
                keyboard: [
                    [{ text: "📱 Share Contact", request_contact: true }]
                ],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        });
    }
});

bot.on("message", (msg) => {
    if (msg.web_app_data) {
        try {
            const orderData = JSON.parse(msg.web_app_data.data);
            let message = "🛒 Order Details:\n";
            orderData.items.forEach((item) => {
                message += `${item.name} - ${item.quantity}x\n`;
            });
            message += `\n💰 Total: ${orderData.total} USD`;
            bot.sendMessage(msg.chat.id, message);
        } catch (error) {
            console.error("Error parsing WebApp data:", error);
        }
    }
});

const CONTACTS_FILE = "./contacts.json";
let userContacts = new Map();
// const userInfo = new Map();


if (existsSync(CONTACTS_FILE)) {
    const data = readFileSync(CONTACTS_FILE, "utf8");
    userContacts = new Map(Object.entries(JSON.parse(data)));
}

bot.on("contact", (msg) => {
    console.log("📩 Received Contact Data:", msg);

    if (msg.contact?.phone_number) {
        const chatId = String(msg.chat.id);
        userContacts.set(chatId, msg.contact.phone_number);

        try {
            // ✅ Save to JSON file with error handling
            writeFileSync(CONTACTS_FILE, JSON.stringify(Object.fromEntries(userContacts)));
            console.log(`✅ Saved Contact: ${chatId} => ${msg.contact.phone_number}`);
        } catch (error) {
            console.error("❌ Failed to save contact:", error);
        }

        bot.sendMessage(msg.chat.id, `✅ Phone number saved: ${msg.contact.phone_number}`);
    } else {
        bot.sendMessage(msg.chat.id, "❌ No phone number found.");
    }
});