import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./config.js";
import Product from "./models/Product.js";
import TelegramBot from "node-telegram-bot-api";
import { existsSync, readFileSync, writeFileSync } from "fs";

dotenv.config();

const app = express();
app.use(bodyParser.json());



// ✅ Allowed frontend origins
const allowedOrigins = [
    "http://localhost:5173",
    "https://test-web-site-template.netlify.app",
    "https://web.telegram.org"
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin) || origin.includes("web.telegram.org")) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    methods: "GET,POST",
    allowedHeaders: "Content-Type",
    credentials: true
}));

// ✅ Connect to MongoDB before starting the server
connectDB().then(() => {
    app.listen(5000, "0.0.0.0", () => console.log("🚀 Server running on port 5000"));
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
        console.error("Error fetching products:", error);
        res.status(500).json({ error: error.message });
    }
});

// ✅ Telegram Bot Setup
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
    console.error("❌ Telegram Bot Token is missing in environment variables.");
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, {
    polling: {
        interval: 300,
        autoStart: true,
    },
});

// ✅ Delete webhook before polling (to avoid conflicts)
const deleteWebhook = async () => {
    try {
        const response = await fetch(`https://api.telegram.org/bot${TOKEN}/deleteWebhook`);
        console.log("✅ Webhook deleted:", await response.json());
    } catch (error) {
        console.error("❌ Error deleting webhook:", error);
    }
};

(async () => {
    await deleteWebhook();
})();

// ✅ Set up Webhook
bot.setWebHook(`https://backend-xzwz.onrender.com/webhook`);

// ✅ Webhook route for Telegram updates
app.post("/webhook", (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// ✅ Handle /start command
bot.onText(/\/start/, (msg) => {
    const options = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Hello", callback_data: "hello" }],
                [{ text: "Visit Website", url: "https://test-web-site-template.netlify.app/" }],
                [{ text: "Share Contact", callback_data: "share_contact" }]
            ]
        }
    };

    bot.sendMessage(msg.chat.id, "Hello! Welcome to the bot.", options);
    console.log("New user:", msg.chat.id);
});

// ✅ Handle Inline Buttons
bot.on("callback_query", (msg) => {
    if (msg.data === "share_contact") {
        bot.sendMessage(msg.message.chat.id, "Please share your contact:", {
            reply_markup: {
                keyboard: [[{ text: "📱 Share Contact", request_contact: true }]],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        });
    }
});

// ✅ Save user contacts
const CONTACTS_FILE = "./contacts.json";
let userContacts = new Map();

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

// ✅ Handle orders from Telegram WebApp
// bot.on("web_app_data", async (msg) => {
//     try {
//         if (!msg.web_app_data?.data) {
//             bot.sendMessage(msg.chat.id, "❌ No order data received.");
//             return;
//         }

//         const data = JSON.parse(msg.web_app_data.data);
//         if (!Array.isArray(data) || data.length < 2) {
//             bot.sendMessage(msg.chat.id, "❌ Invalid order format.");
//             return;
//         }

//         const user = data[0]?.user;
//         const cart = data[1]?.cart;

//         if (!user || !cart) {
//             bot.sendMessage(msg.chat.id, "❌ Missing order details.");
//             return;
//         }

//         console.log("📩 Received order data:", data);

//         let orderMessage = `📝 New Order from ${user.name}\n📞 Phone: ${user.phone}\n📍 Delivery Type: ${user.deliveryType}`;

//         if (user.deliveryType === "delivery") {
//             orderMessage += `\n📌 Location: ${user.location}\n📍 Coordinates: ${user.coordinates}`;
//         }

//         orderMessage += `\n🛒 Order Items:\n`;
//         cart.forEach((item, index) => {
//             orderMessage += `\n${index + 1}. ${item.name} - ${item.quantity} x ${item.price}₽`;
//         });

//         if (user.comment) {
//             orderMessage += `\n💬 Comment: ${user.comment}`;
//         }

//         orderMessage += `\n✅ Order received!`;

//         bot.sendMessage(msg.chat.id, orderMessage);
//         console.log("✅ Order sent to chat:", msg.chat.id);

//         // ✅ Forward order to restaurant's Telegram chat
//         // const RESTAURANT_CHAT_ID = process.env.RESTAURANT_CHAT_ID;
//         // if (RESTAURANT_CHAT_ID) {
//         //     bot.sendMessage(RESTAURANT_CHAT_ID, orderMessage);
//         //     console.log("✅ Order forwarded to restaurant chat:", RESTAURANT_CHAT_ID);
//         // }

//     } catch (error) {
//         console.error("❌ Error processing web_app_data:", error);
//         bot.sendMessage(msg.chat.id, "❌ Error processing order.");
//     }
// });

// ✅ General message logging
bot.on("message", (msg) => {
    try {
        if (msg.web_app_data) {
            console.log("📩 Web App Data Received:", JSON.stringify(msg.web_app_data, null, 2));
        } else {
            console.log("📩 Normal message received:", msg.text);
        }
    } catch (error) {
        console.error("❌ Error in message handler:", error);
    }
});



const OWNER_CHAT_IDS = process.env.OWNER_CHAT_IDS.split(",").map(id => id.trim());

const userOrders = new Map(); // Store user chat IDs and their phone numbers

app.post("/web-data", async (req, res) => {
    try {
        const data = req.body;
        console.log("📩 Received order data from frontend:", data);

        if (!Array.isArray(data) || data.length < 2) {
            return res.status(400).json({ error: "❌ Invalid order format." });
        }

        const user = data[0]?.user;
        const cart = data[1]?.cart;

        if (!user || !cart || !user.chatId) {  // Ensure chatId is received
            return res.status(400).json({ error: "❌ Missing order details or chat ID." });
        }

        // Save user chat ID for later order updates
        userOrders.set(user.phone, user.chatId);

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

        // ✅ Send order to all restaurant owners
        OWNER_CHAT_IDS.forEach(chatId => {
            bot.sendMessage(chatId, orderMessage, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "✅ Accept Order", callback_data: `accept_${user.phone}` }],
                        [{ text: "❌ Deny Order", callback_data: `deny_${user.phone}` }]
                    ]
                }
            });
        });

        console.log("✅ Order sent to restaurant owners:", OWNER_CHAT_IDS);
        res.json({ success: true, message: "✅ Order received and sent to Telegram bot." });

    } catch (error) {
        console.error("❌ Error processing order:", error);
        res.status(500).json({ error: "❌ Internal server error." });
    }
});



bot.on("callback_query", async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const data = callbackQuery.data;

    if (data.startsWith("accept_")) {
        const userPhone = data.split("_")[1];

        if (userOrders.has(userPhone)) {
            const userChatId = userOrders.get(userPhone);
            bot.sendMessage(userChatId, "✅ Your order has been accepted!");
        } else {
            console.error("❌ User chat ID not found for phone:", userPhone);
        }

        bot.sendMessage(chatId, "✅ Order accepted!");
    }

    if (data.startsWith("deny_")) {
        const userPhone = data.split("_")[1];

        if (userOrders.has(userPhone)) {
            const userChatId = userOrders.get(userPhone);
            bot.sendMessage(userChatId, "❌ Your order has been denied.");
        } else {
            console.error("❌ User chat ID not found for phone:", userPhone);
        }

        bot.sendMessage(chatId, "❌ Order denied.");
    }
});
