import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./config.js";
import Product from "./models/Product.js";
import TelegramBot from "node-telegram-bot-api";
import { existsSync, readFileSync, writeFileSync } from "fs";
import botUser from "./models/botUser.js";
import axios from "axios";
import botScheduleModel from "./models/botModel.js";
dotenv.config();



const CONTACTS_FILE = "./contacts.json";
const app = express();
const allowedOrigins = [
    "http://localhost:5174",
    "https://test-web-site-template.netlify.app",
    "https://web.telegram.org",
    "https://localhost:5000"
];
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN, {
    polling: {
        interval: 300,
        autoStart: true,
    },
});
let userContacts = new Map();
const OWNER_CHAT_IDS = process.env.OWNER_CHAT_IDS.split(",").map(id => id.trim());
const userOrders = new Map();



app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());
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


connectDB().then(() => {
    app.listen(5000, "0.0.0.0", () => console.log("🚀 Server running on port 5000"));
});


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
app.post("/web-data", async (req, res) => {
    try {
        const data = req.body;
        console.log("📩 Received order data from frontend:", data);
        const user = data.user;
        const cart = data.cart;
        const userChatIDfromWEB = user.userID
        const orderID = data.orderID.id
        const TotalPrice = data.orderID.price
        let message = `📝  #${orderID} Order from ${user.name}\n📞 Phone: ${user.phone}\n📍 Delivery Type: ${user.deliveryType}`;


        if (user.deliveryType === "delivery" && user.coordinates) {
            let latitude, longitude;

            if (Array.isArray(user.coordinates) && user.coordinates.length === 2) {

                [latitude, longitude] = user.coordinates;
            } else if (typeof user.coordinates === "string" && user.coordinates.includes(",")) {

                [latitude, longitude] = user.coordinates.split(",");
            } else {
                console.error("❌ Invalid coordinates format:", user.coordinates);
                latitude = longitude = null;
            }

            if (latitude && longitude) {
                const mapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
                message += `\n📌 Manzil: ${user.location}`;
                message += `\n📍 [📍 Xaritadan ko'rish](${mapsLink})`;
            } else {
                message += `\n📌 Manzil: ${user.location} (Invalid coordinates)`;
            }
        }

        message += "\n🛒 Order Items:\n";
        cart.forEach((item, index) => {
            message += `${index + 1}. ${item.name} - ${item.quantity} x ${item.price}₽\n ,`;

            if (item.size?.name) {
                message += `, ${item.size.name}sm`;
            }

            message += "\n";

            if (Array.isArray(item.topping) && item.topping.length > 0) {
                message += `   🧀 Toppings: ${item.topping.map(topping => topping).join(", ")}\n`;
            }

        });
        if (user.comment) {
            message += `💬 Comment: ${user.comment}\n`;
        }
        message += `\n💰 Total Price: ${TotalPrice}₽`;
        OWNER_CHAT_IDS.forEach(chatID => {
            bot.sendMessage(chatID, `new order from client , ${message} `,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ Accept Order", callback_data: `accept_${userChatIDfromWEB}_${orderID}_${user.deliveryType}` }],
                            [{ text: "❌ Deny Order", callback_data: `deny_${userChatIDfromWEB}_${orderID}_${user.deliveryType} ` }]
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
app.post("/send-broadcast", async (req, res) => {
    try {
        const { title, message, imageUrl, secretKey } = req.body;
        if (req.body.secretKey !== process.env.SECRET_KEY) {
            return res.status(403).json({ message: "❌ Unauthorized request!" });
        }

        if (!title || !message) {
            return res.status(400).json({ message: "❌ Title and message are required!" });
        }
        const users = await botUser.find({}, "chatId");
        if (!users.length) {
            return res.status(404).json({ message: "❌ No users found to send broadcast!" });
        }
        let successCount = 0;
        for (const user of users) {
            const success = await sendMessage(user.chatId, title, message, imageUrl);
            if (success) successCount++;
        }
        res.json({ message: `✅ Broadcast sent to ${successCount} users!` });

    } catch (error) {
        console.error("❌ Broadcast Error:", error);
        res.status(500).json({ message: "❌ Failed to send broadcast", error: error.message });
    }
});


if (!TOKEN) {
    console.error("❌ Telegram Bot Token is missing in environment variables.");
    process.exit(1);
}



const deleteWebhook = async () => {
    try {
        const response = await fetch(`https://api.telegram.org/bot${TOKEN}/deleteWebhook`);
        console.log(response);
    } catch (error) {
        console.error("❌ Error deleting webhook:", error);
    }
};
(async () => {
    await deleteWebhook();
})();
bot.setWebHook(`https://backend-xzwz.onrender.com/webhook`);
app.post("/webhook", (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

bot.onText(/\/start/, async (msg) => {
    const chatId = String(msg.chat.id);
    const username = msg.chat.username || "Unknown";
    const existingUser = await botUser.findOne({ chatId });
    const botActive = await isBotWorking();
    if (!botActive) {
        bot.sendMessage(msg.chat.id, "❌Restuarant hozir ishlamayapti , keyinroq urunib ko'ring");
        return;
    } else {
        if (existingUser) {
            bot.sendMessage(chatId, "✅ Siz ro'yxatdan o'tdingiz");
            return;
        }
        bot.sendMessage(chatId, "📲 Iltimos telefon raqamingizni ulashing", {
            reply_markup: {
                keyboard: [[{ text: "Raqamni ulashish 📞", request_contact: true }]],
                one_time_keyboard: true,
            },
        });
    }
});
bot.on("contact", async (msg) => {
    const chatId = String(msg.chat.id);
    const username = msg.chat.username || "Unknown";
    const phoneNumber = msg.contact.phone_number;

    try {
        await botUser.findOneAndUpdate(
            { chatId },
            { $set: { username, phone: phoneNumber } },
            { upsert: true, new: true }
        );



        bot.sendMessage(chatId, "✅ Siz ro'yhatdan o'tib bo'lgansiz");
    } catch (error) {
        console.error("❌ Error saving user:", error);
    }
});

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
        } catch (error) {
            console.error("❌ Failed to save contact:", error);
        }
        bot.sendMessage(msg.chat.id, `✅ Raqamingiz saqlandi: ${msg.contact.phone_number}`);
    } else {
        bot.sendMessage(msg.chat.id, "❌ Raqam topilmadi.");
    }
});


bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const botActive = await isBotWorking();
    if (!botActive) {
        bot.sendMessage(chatId, "❌ Restuarant hozir ishlamayapti. Iltimos, ish vaqtida qayta urinib ko'ring.");
        return;
    }
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


bot.on("callback_query", async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const messageId = msg.message_id;
    const data = callbackQuery.data
    const action = data.split("_")[0]
    const customerChatId = callbackQuery.data.split("_")[1];
    const OrderID = callbackQuery.data.split("_")[2]
    const DeliveryType = callbackQuery.data.split("_")[3]

    if (!customerChatId) {
        console.error("❌ Customer chat ID missing:", callbackQuery.data);
        return;
    }
    try {
        switch (action) {
            case "accept":
                bot.sendMessage(chatId, `✅ Order ${OrderID} accepted!`);
                bot.sendMessage(customerChatId, `✅ Sizning ${OrderID} buyurtmangiz qabul qilindi!`);
                bot.editMessageReplyMarkup(
                    { inline_keyboard: [[{ text: "✅ Order Done", callback_data: `done_${customerChatId}_${OrderID}` }]] },
                    { chat_id: chatId, message_id: messageId }
                );
                break;

            case "deny":
                bot.sendMessage(chatId, `❌ Order ${OrderID} denied.`);
                bot.sendMessage(customerChatId, "❌ Sizning buyurtmangizzni qabul qilmaymiz.");
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
                break;

            case "done":
                bot.sendMessage(chatId, `✅ Order ${OrderID} marked as done!`);
                bot.sendMessage(customerChatId, `✅ Sizning ${OrderID} buyurtmangiz  yetkazib berishga/olib ketishga tayyor`);
                bot.editMessageReplyMarkup({ inline_keyboard: [[{ text: "deliver/take Out", callback_data: `deliver_${customerChatId}_${OrderID}_${DeliveryType}` }]] }, { chat_id: chatId, message_id: messageId });
                break;

            case "deliver":
                const doneMessage = DeliveryType === "delivery"
                    ? "✅  yetkazib berildi!"
                    : "✅  olib ketildi!";

                bot.sendMessage(chatId, `✅ Order ${OrderID} ${doneMessage}`)
                bot.sendMessage(customerChatId, `✅ Sizning ${OrderID} buyurtmangiz ${doneMessage} `)

                bot.sendMessage(customerChatId, "⭐ Buyurtmangizdan mamnun bo'ldingizmi? Iltimos, baho bering!", {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "1⭐", callback_data: `review_1_${OrderID}_${customerChatId}` },
                                { text: "2⭐", callback_data: `review_2_${OrderID}_${customerChatId}` },
                                { text: "3⭐", callback_data: `review_3_${OrderID}_${customerChatId}` },
                                { text: "4⭐", callback_data: `review_4_${OrderID}_${customerChatId}` },
                                { text: "5⭐", callback_data: `review_5_${OrderID}_${customerChatId}` }
                            ]
                        ]
                    }
                });
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
                break;

            case "review":
                const parts = data.split("_");
                const rating = parts[1];
                bot.sendMessage(customerChatId, `🎉 Rahmat! Siz ${rating} baho berdingiz.`);
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: customerChatId, message_id: messageId });
                bot.sendMessage(chatId, `📢 Yangi baho qabul qilindi!  
                    🛒 Buyurtma #${OrderID}  
                    ⭐ Baho: ${rating} yulduz`);
                break;


        }

    } catch (error) {
        console.error("❌ Error handling callback query:", error);
    }
});

// bot.on("callback_query", async (query) => {
//     // const chatId = query.message.chat.id;
//     const data = query.data;

//     if (data.startsWith("review_")) {
//         const parts = data.split("_");
//         const rating = parts[1];
//         const orderId = parts[2];
//         const customerChatId = parts[3];

//         bot.sendMessage(customerChatId, `🎉 Rahmat! Siz ${rating}⭐ baho berdingiz.`);

//         bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: customerChatId, message_id: messageId });

//         OWNER_CHAT_IDS.forEach(adminChatID => {
//             bot.sendMessage(adminChatID, `📢 Yangi baho qabul qilindi!  
// 🛒 Buyurtma #${orderId}  
// ⭐ Baho: ${rating} yulduz`);
//         });
//     }
// });


const sendMessage = async (chatId, title, message, imageUrl) => {
    try {
        await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text: `📢 *${title}*\n\n${message}`,
            parse_mode: "Markdown",
        });
        if (imageUrl) {
            await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
                chat_id: chatId,
                photo: imageUrl,
                caption: `📢 *${title}*\n\n${message}`,
                parse_mode: "Markdown",
            });
        }
        return true;
    } catch (error) {
        console.error(`❌ Failed to send message to ${chatId}:`, error.response?.data || error.message);
        return false;
    }
};
async function isBotWorking() {
    try {
        const scheduleData = await botScheduleModel.findOne();
        const now = new Date();
        const dayNames = [
            "Yakshanba", // Sunday
            "Dushanba",  // Monday
            "Seshanba",  // Tuesday
            "Chorshanba", // Wednesday
            "Payshanba", // Thursday
            "Juma",      // Friday
            "Shanba"     // Saturday
        ];
        const dayOfWeek = dayNames[now.getDay()];
        const currentTime = now.getHours() * 60 + now.getMinutes();
        const todaySchedule = scheduleData.schedule[dayOfWeek];

        if (!scheduleData) {
            console.error("⚠️ No schedule found in DB.");
            return false;
        }

        if (scheduleData.isEmergencyOff) {
            console.log("⚠️ Emergency mode is ON. Bot is disabled.");
            return false;
        }
        if (!todaySchedule) {
            console.log(`⚠️ No schedule found for ${dayOfWeek}.`);
            return false;
        }

        const startMinutes = todaySchedule.startHour * 60;
        const endMinutes = todaySchedule.endHour * 60;

        return currentTime <= startMinutes && currentTime >= endMinutes;
    } catch (error) {
        console.error("❌ Error checking bot schedule:", error);
        return false;
    }
}


