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

    bot.sendMessage(msg.chat.id, "Hello! Welcome to the bot.");

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


// ✅ General message logging
bot.on("message", (msg) => {
    try {
        if (msg.web_app_data) {
            console.log("📩 Web App Data Received: asosiy", JSON.stringify(msg.web_app_data, null, 2));
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



        const user = data.user;
        const cart = data.cart;
        console.log(user.userID.chatID);
        const userChatIDfromWEB = user.userID.chatID


        let message = `📝 Order from ${user.name}\n📞 Phone: ${user.phone}\n📍 Delivery Type: ${user.deliveryType}`;

        // ✅ Check if `coordinates` exist and are in correct format
        if (user.deliveryType === "delivery" && user.coordinates) {
            let latitude, longitude;

            if (Array.isArray(user.coordinates) && user.coordinates.length === 2) {
                // Case 1: If coordinates are an array: [latitude, longitude]
                [latitude, longitude] = user.coordinates;
            } else if (typeof user.coordinates === "string" && user.coordinates.includes(",")) {
                // Case 2: If coordinates are a string: "latitude,longitude"
                [latitude, longitude] = user.coordinates.split(",");
            } else {
                console.error("❌ Invalid coordinates format:", user.coordinates);
                latitude = longitude = null;
            }

            if (latitude && longitude) {
                const mapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
                message += `\n📌 Location: ${user.location}`;
                message += `\n📍 [📍 View on Map](${mapsLink})`;  // Clickable link
            } else {
                message += `\n📌 Location: ${user.location} (Invalid coordinates)`;
            }
        }

        message += `\n🛒 Order Items:\n`;

        cart.forEach((item, index) => {
            message += `${index + 1}. ${item.name} - ${item.quantity} x ${item.price}₽\n`;
        });

        if (user.comment) {
            message += `💬 Comment: ${user.comment}`;
        }

        console.log(message);





        OWNER_CHAT_IDS.forEach(chatID => {
            bot.sendMessage(chatID, `new order from client , ${message} `,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ Accept Order", callback_data: `accept_${userChatIDfromWEB}` }],
                            [{ text: "❌ Deny Order", callback_data: `deny_${userChatIDfromWEB} ` }]
                        ]
                    }
                }
            )
        })








        res.json({ success: true, message: "✅ Order received and sent to Telegram bot." });

    } catch (error) {
        console.error("❌ Error processing order:", error);
        res.status(500).json({ error: "❌ Internal server error." });
    }
});






bot.on("callback_query", async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const messageId = msg.message_id; // Needed for editing messages
    const data = callbackQuery.data;
    console.log(chatId);
    console.log('bu kllientni chat idsi  ', data);


    // Extract the customer chat ID directly from the callback data
    const customerChatId = data.split("_")[1];

    if (!customerChatId) {
        console.error("❌ Customer chat ID missing in callback data:", data);
        return;
    }

    if (data.startsWith("accept_")) {
        bot.sendMessage(chatId, "✅ Order accepted!");

        // ✅ Send message to the customer using their chat ID
        bot.sendMessage(customerChatId, "✅ Your order has been accepted!");

        // ✅ Update the inline keyboard to show "Order Done" button
        bot.editMessageReplyMarkup(
            {
                inline_keyboard: [
                    [{ text: "✅ Order Done", callback_data: `done_${customerChatId}` }]
                ]
            },
            { chat_id: chatId, message_id: messageId }
        );
    }

    if (data.startsWith("deny_")) {
        bot.sendMessage(chatId, "❌ Order denied.");

        // ✅ Notify the customer
        bot.sendMessage(customerChatId, "❌ Your order has been denied.");

        // ✅ Remove inline keyboard
        bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: messageId }
        );
    }

    if (data.startsWith("done_")) {
        bot.sendMessage(chatId, "✅ Order is marked as done!");
        bot.sendMessage(customerChatId, "✅ Your order has been done and will be delivered soon ");


        // ✅ Remove "Order Done" button after it's clicked
        bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: messageId }
        );
    }
});
