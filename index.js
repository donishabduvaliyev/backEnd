import express from "express";
import bodyParser from "body-parser";


import cors from "cors";
import connectDB from "./config.js"; // Import connectDB
import Product from "./models/Product.js";  // Import Product model
import dotenv from "dotenv";
dotenv.config();

import TelegramBot from "node-telegram-bot-api";
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { userInfo } from "os";
import { log } from "console";

const app = express();
app.use(bodyParser.json());

console.log('running');


const allowedOrigins = [
    "http://localhost:5173", // Development frontend
    "https://test-web-site-template.netlify.app", // ✅ Netlify frontend
    "https://web.telegram.org"

];

// app.listen(5000, "0.0.0.0", () => console.log("Server running..."));


app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    methods: "GET,POST",
    allowedHeaders: "Content-Type"
}));


// ✅ Connect to MongoDB Before Starting Server
connectDB().then(() => {
    // app.listen(5000, () => console.log(`🚀 Server running on http://192.168.172.33:5000`));

    app.listen(5000, "0.0.0.0", () => console.log("Server running..."));

});

// ✅ API Routes
app.get("/", (req, res) => {
    res.send("Server is running!");
});

app.get("/api/products", async (req, res) => {
    try {
        const products = await Product.find();
        res.json(products);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});














 // ✅ Use `await` at top-level if using ES modules





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






const deleteWebhook = async () => {
    try {
        const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/deleteWebhook`);
        console.log("✅ Webhook deleted:", await response.json());
    } catch (error) {
        console.error("❌ Error deleting webhook:", error);
    }
};

await deleteWebhook();


bot.setWebHook(`https://backend-xzwz.onrender.com/webhook`);

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
    console.log('bot is running');

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

// bot.on("message", (msg) => {
//     if (msg.web_app_data) {
//         try {
//             const orderData = JSON.parse(msg.web_app_data.data);
//             let message = "🛒 Order Details:\n";
//             orderData.items.forEach((item) => {
//                 message += `${item.name} - ${item.quantity}x\n`;
//             });
//             message += `\n💰 Total: ${orderData.total} USD`;
//             bot.sendMessage(msg.chat.id, message);
//         } catch (error) {
//             console.error("Error parsing WebApp data:", error);
//         }
//     }
// });

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



bot.on("web_app_data", (msg) => {
    try {
        if (!msg.web_app_data?.data) {
            bot.sendMessage(msg.chat.id, "❌ No order data received.");
            return;
        }

        const data = JSON.parse(msg.web_app_data.data); // Parse received JSON

        if (!Array.isArray(data) || data.length < 2) {
            bot.sendMessage(msg.chat.id, "❌ Invalid order format.");
            return;
        }

        const user = data[0]?.user;  // First object → user info
        const cart = data[1]?.cart;  // Second object → cart items

        if (!user || !cart) {
            bot.sendMessage(msg.chat.id, "❌ Missing order details.");
            return;
        }

        console.log("📩 Received order data:", data);

        let orderMessage = `📝 New Order from ${user.name}\n📞 Phone: ${user.phone}\n📍 Delivery Type: ${user.deliveryType}`;

        if (user.deliveryType === "delivery") {
            orderMessage += `\n📌 Location: ${user.location}\n📍 Coordinates: ${user.coordinates}`;
        }

        orderMessage += `\n🛒 Order Items:\n`;
        cart.forEach((item, index) => {
            orderMessage += `\n${index + 1}. ${item.name} - ${item.quantity} x ${item.price}₽`;
        });

        if (user.comment) {
            orderMessage += `\n💬 Comment: ${user.comment}`;
        }

        orderMessage += `\n✅ Order received!`;

        // ✅ Send order details to restaurant chat
        bot.sendMessage(msg.chat.id, orderMessage);
        console.log("✅ Order sent to chat:", msg.chat.id);

    } catch (error) {
        console.error("❌ Error processing web_app_data:", error);
        bot.sendMessage(msg.chat.id, "❌ Error processing order.");
    }
});
