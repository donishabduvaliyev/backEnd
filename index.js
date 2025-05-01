import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose"; // Assuming connectDB handles mongoose internally
import TelegramBot from "node-telegram-bot-api";
import axios from "axios";

// Import local modules
import connectDB from "./config.js"; // Database connection setup
import Product from "./models/Product.js"; // Product schema/model
import botUser from "./models/botUser.js"; // Bot user schema/model
import botScheduleModel from "./models/botModel.js"; // Schedule schema/model

dotenv.config();

// --- Configuration ---
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_CHAT_IDS = process.env.OWNER_CHAT_IDS ? process.env.OWNER_CHAT_IDS.split(",").map(id => id.trim()) : [];
const ADMIN_API_BASE_URL = process.env.ADMIN_SERVER_API_URL; // e.g., http://localhost:5001/api/orders
const ADMIN_API_KEY = process.env.ADMIN_SERVER_API_KEY; // API Key for securing bot<->admin communication
const WEBHOOK_URL = process.env.WEBHOOK_URL; // e.g., https://your-render-app.onrender.com/webhook
const BOT_SERVER_PORT = process.env.PORT || 5000;
const TIMEZONE = "Asia/Tashkent"; // Timezone for schedule checking

// --- Input Validation ---
if (!TOKEN) {
    console.error("❌ FATAL ERROR: TELEGRAM_BOT_TOKEN is missing in environment variables.");
    process.exit(1);
}
if (OWNER_CHAT_IDS.length === 0) {
    console.error("❌ FATAL ERROR: OWNER_CHAT_IDS environment variable is required (comma-separated).");
    process.exit(1);
}
if (!ADMIN_API_BASE_URL) {
    console.error("❌ FATAL ERROR: ADMIN_SERVER_API_URL environment variable is not set.");
    process.exit(1); // Crucial for order processing
}

// --- Initialization ---
const app = express();
const bot = new TelegramBot(TOKEN);

// --- Middleware ---
const allowedOrigins = [
    "http://localhost:5174", // Frontend dev
    "http://localhost:5173", // Another frontend dev port?
    "https://test-web-site-template.netlify.app", // Frontend prod
    "https://web.telegram.org", // Telegram Web Apps
    `http://localhost:${BOT_SERVER_PORT}` // Allow requests from self if needed
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin) || origin.includes("web.telegram.org")) {
            callback(null, true);
        } else {
            console.warn(`🚫 CORS blocked origin: ${origin}`);
            callback(new Error(`Origin ${origin} not allowed by CORS`));
        }
    },
    methods: "GET,POST,PUT,DELETE",
    allowedHeaders: "Content-Type, Authorization, X-API-Key", // Added X-API-Key
    credentials: false
}));

app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// --- API Key Authentication Middleware (for Bot Server's own protected endpoints) ---
const requireApiKeyForBot = (req, res, next) => {
    const apiKey = req.get('X-API-Key');
    const expectedApiKey = ADMIN_API_KEY; // Use the same key admin server uses to call this bot server

    if (expectedApiKey && apiKey !== expectedApiKey) {
        console.warn(`⚠️ [Bot Endpoint] Forbidden API access attempt. Endpoint: ${req.originalUrl}`);
        return res.status(403).json({ message: 'Forbidden: Invalid API Key' });
    }
    next();
};


connectDB().then(() => {
    app.listen(5000, "0.0.0.0", () => console.log("🚀 Server running on port 5000"));
});

// --- Telegram Webhook Setup ---
if (WEBHOOK_URL) {
    bot.setWebHook(WEBHOOK_URL)
        .then(() => console.log(`✅ Telegram Webhook set to ${WEBHOOK_URL}`))
        .catch(err => console.error(`❌ Failed to set Telegram webhook: ${err.message}`));
} else {
    console.warn("⚠️ WEBHOOK_URL environment variable not set. Bot might not receive updates in production.");
    // For local development without setting up tunneling/webhook:
    // console.log("ℹ️ Starting bot in polling mode for development.");
    // bot.deleteWebHook().then(() => bot.startPolling()).catch(err => console.error("Polling error:", err));
}


// --- Helper Functions ---

/**
 * Checks if the restaurant is open based on the schedule in the database.
 * @returns {Promise<boolean>} True if the restaurant is open, false otherwise.
 */
async function isBotWorking() {
    try {
        const scheduleData = await botScheduleModel.findOne();
        if (!scheduleData) {
            console.error("⚠️ No schedule found in DB. Assuming closed.");
            return false;
        }
        if (scheduleData.isEmergencyOff) {
            console.log("⚠️ Emergency mode is ON. Bot is disabled.");
            return false;
        }

        const now = new Date();
        const nowInTimezone = new Date(now.toLocaleString("en-US", { timeZone: TIMEZONE }));

        const dayNames = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
        const dayOfWeek = dayNames[nowInTimezone.getDay()];
        const currentTimeMinutes = nowInTimezone.getHours() * 60 + nowInTimezone.getMinutes();

        const todaySchedule = scheduleData.schedule[dayOfWeek];
        if (!todaySchedule || !todaySchedule.isOpen) {
            console.log(`ℹ️ Restaurant is closed today (${dayOfWeek}) according to schedule.`);
            return false;
        }

        const startMinutes = todaySchedule.startHour * 60;
        const endMinutes = todaySchedule.endHour * 60;

        if (endMinutes < startMinutes) { // Overnight schedule
            if (currentTimeMinutes >= startMinutes || currentTimeMinutes < endMinutes) {
                console.log(`ℹ️ Bot is working (overnight). Current: ${currentTimeMinutes}, Range: ${startMinutes}-${endMinutes}`);
                return true;
            }
        } else { // Same-day schedule
            if (currentTimeMinutes >= startMinutes && currentTimeMinutes < endMinutes) {
                console.log(`ℹ️ Bot is working. Current: ${currentTimeMinutes}, Range: ${startMinutes}-${endMinutes}`);
                return true;
            }
        }

        console.log(`ℹ️ Bot is outside working hours for ${dayOfWeek}. Current: ${currentTimeMinutes}, Range: ${startMinutes}-${endMinutes}`);
        return false;

    } catch (error) {
        console.error("❌ Error checking bot schedule:", error);
        return false; // Default to closed on error
    }
}

/**
 * Sends a request to the admin server to update the status of an order.
 * @param {string} orderId - The MongoDB ID of the order.
 * @param {string} status - The new status (e.g., 'accepted', 'denied', 'ready', 'completed').
 * @returns {Promise<boolean>} - True if the update was successful (API returned 2xx), false otherwise.
 */
async function updateOrderStatusOnAdminServer(orderId, status) {
    const apiUrl = `${ADMIN_API_BASE_URL}/api/receive-order/${orderId}/status`; // Append path to base URL
    console.log(`📤 Attempting to update order ${orderId} status to '${status}' via ${apiUrl}`);

    try {
        const axiosConfig = { headers: { 'Content-Type': 'application/json' } };
        if (ADMIN_API_KEY) {
            axiosConfig.headers['X-API-Key'] = ADMIN_API_KEY;
        }
        const response = await axios.put(apiUrl, { status }, axiosConfig);
        if (response.status >= 200 && response.status < 300) {
            console.log(`✅ Successfully updated order ${orderId} status to '${status}' on admin server.`);
            return true;
        } else {
            console.warn(`⚠️ Admin server responded with status ${response.status} for order ${orderId} status update.`);
            return false;
        }
    } catch (error) {
        console.error(`❌ Error updating status for order ${orderId} to '${status}':`, error.response?.data || error.message);
        return false;
    }
}

/**
 * Sends the review rating to the admin server API.
 * @param {string} orderId - The MongoDB ID of the order.
 * @param {number} rating - The rating value (1-5).
 * @returns {Promise<boolean>} - True if the update was successful (API returned 2xx), false otherwise.
 */
async function sendReviewToAdminServer(orderId, rating) {
    const apiUrl = `${ADMIN_API_BASE_URL}/api/receive-order/${orderId}/review`; // Append path to base URL
    console.log(`📤 Sending review for order ${orderId} (Rating: ${rating}) to ${apiUrl}`);
    try {
        const axiosConfig = { headers: { 'Content-Type': 'application/json' } };
        if (ADMIN_API_KEY) {
            axiosConfig.headers['X-API-Key'] = ADMIN_API_KEY;
        }
        const response = await axios.put(apiUrl, { rating }, axiosConfig);
        if (response.status >= 200 && response.status < 300) {
            console.log(`✅ Successfully sent review for order ${orderId} to admin server.`);
            return true;
        } else {
            console.warn(`⚠️ Admin server responded with status ${response.status} for order ${orderId} review submission.`);
            return false;
        }
    } catch (error) {
        console.error(`❌ Error sending review for order ${orderId}:`, error.response?.data || error.message);
        return false;
    }
}

/**
 * Sends a broadcast message, handling photos and potential errors.
 * Uses Markdown V1 for caption simplicity with axios.
 * @param {string} chatId - Target chat ID.
 * @param {string} title - Broadcast title.
 * @param {string} message - Broadcast message body.
 * @param {string|null} imageUrl - Optional URL of an image to send.
 * @returns {Promise<boolean>} - True if message sent successfully, false otherwise.
 */
const sendBroadcastMessage = async (chatId, title, message, imageUrl) => {
    const text = `📢 *${title}*\n\n${message}`; // Markdown V1
    try {
        if (imageUrl) {
            await axios.post(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, {
                chat_id: chatId,
                photo: imageUrl,
                caption: text,
                parse_mode: "Markdown",
            });
        } else {
            await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
                chat_id: chatId,
                text: text,
                parse_mode: "Markdown",
            });
        }
        return true;
    } catch (error) {
        const errorData = error.response?.data;
        if (errorData && (errorData.error_code === 429 || errorData.error_code === 403)) {
            console.warn(`❌ Blocked/Rate limited sending broadcast to ${chatId}: ${errorData.description}`);
        } else {
            console.error(`❌ Failed to send broadcast message to ${chatId}:`, errorData || error.message);
        }
        return false;
    }
};

/**
 * Sanitizes text for Telegram MarkdownV2.
 * @param {string} text - The text to sanitize.
 * @returns {string} - Sanitized text.
 */
const sanitizeMarkdownV2 = (text = '') => {
    // Escape characters: _ * [ ] ( ) ~ ` > # + - = | { } . !
    return String(text).replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
};


// --- Express Routes ---

// Base route
app.get("/", (req, res) => {
    res.send("✅ Bot Server is running!");
});

// Telegram webhook endpoint
app.post("/webhook", (req, res) => {
    // Process update asynchronously, respond immediately
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Get products (if needed by web app directly from bot server)
app.get("/api/products", async (req, res) => {
    try {
        const products = await Product.find();
        console.log(`Backend: Found ${products.length} products.`); // Add this line
        res.json(products);
    } catch (error) {
        console.error("Error fetching products:", error);
        res.status(500).json({ error: error.message });
    }
});

// Receive order data from Web App
app.post("/web-data", async (req, res, next) => {
    // 1. Validate Input
    if (!req.body?.cart || !req.body?.user || !req.body?.orderID) {
        console.warn("❌ /web-data: Received incomplete order data:", req.body);
        return res.status(400).json({ error: "Missing required cart, user, or orderID data" });
    }
    const { user, cart, orderID: webAppOrderInfo } = req.body;
    const { id: webAppOrderID, price: totalPrice } = webAppOrderInfo; // Destructure

    console.log(`📩 /web-data: Received order from frontend. WebApp Order ID: ${webAppOrderID}`);

    try {
        // 2. Check Working Hours
        // const botWorking = await isBotWorking();
        // if (!botWorking) {
        //     console.log("❌ /web-data: Restaurant is closed. Order rejected.");
        //     bot.sendMessage(user.userID, "❌ Restaurant hozir ishlamayapti. Iltimos, ish vaqtida qayta urinib ko'ring.").catch(err => console.error("Error sending closed message:", err));
        //     return res.status(400).json({ success: false, message: "❌ Restaurant is currently closed." });
        // }

        // 3. Prepare Payload for Admin Server
        const orderPayload = {
            user_id: String(user.userID),
            customer_name: user.name,
            delivery_type: user.deliveryType,
            location_name: user.location,
            products: cart.map(item => ({
                name: item.name,
                quantity: item.quantity,
                price: item.price,
            })),
            total_price: totalPrice,
            delivery_distance: user.deliveryDistance || 0,
            // Include other fields if needed and available from `user` object
            // customer_phone: user.phone,
            // comment: user.comment,
        };

        // 4. Send to Admin Server
        console.log(`📤 /web-data: Sending order payload to Admin Server: ${`${ADMIN_API_BASE_URL}/api/receive-order`}`);
        const axiosConfig = { headers: { 'Content-Type': 'application/json' } };
        if (ADMIN_API_KEY) axiosConfig.headers['X-API-Key'] = ADMIN_API_KEY;

        const adminApiResponse = await axios.post(`${ADMIN_API_BASE_URL}/api/receive-order`, orderPayload, axiosConfig); // POST to base URL

        // 5. Handle Admin Response
        if (adminApiResponse.status === 201 && adminApiResponse.data?.order?._id) {
            const savedOrder = adminApiResponse.data.order;
            const databaseOrderID = savedOrder._id;
            console.log(`✅ /web-data: Order saved on admin server. DB Order ID: ${databaseOrderID}`);

            // 6. Notify Owners
            let messageToOwner = `📝 *New Order Received* \\(${databaseOrderID.toString().slice(-6)}\\)\n\n`;
            messageToOwner += `👤 *Customer:* ${sanitizeMarkdownV2(user.name)}\n`;
            if (user.phone) messageToOwner += `📞 *Phone:* ${sanitizeMarkdownV2(user.phone)}\n`;
            messageToOwner += `🚚 *Type:* ${sanitizeMarkdownV2(user.deliveryType)}\n`;
            if (user.deliveryType === "delivery") {
                messageToOwner += `📍 *Location:* ${sanitizeMarkdownV2(user.location)}\n`;
                try {
                    let latitude, longitude;
                    // Parse coordinates robustly
                    if (Array.isArray(user.coordinates) && user.coordinates.length === 2) {
                        latitude = parseFloat(user.coordinates[0]);
                        longitude = parseFloat(user.coordinates[1]);
                    } else if (typeof user.coordinates === "string" && user.coordinates.includes(",")) {
                        const parts = user.coordinates.split(",");
                        latitude = parseFloat(parts[0]?.trim());
                        longitude = parseFloat(parts[1]?.trim());
                    } else {
                        // Set to null if format is invalid
                        latitude = longitude = null;
                    }

                    // Check if parsing resulted in valid numbers
                    if (latitude !== null && !isNaN(latitude) && longitude !== null && !isNaN(longitude)) {
                        // Use standard Google Maps URL format
                        const mapsLink = `https://maps.google.com/?q=${latitude},${longitude}`;
                        // Sanitize link text for MarkdownV2
                        const linkText = sanitizeMarkdownV2("📍 Xaritadan ko'rish");
                        messageToOwner += `🗺️ [${linkText}](${mapsLink})\n`; // Add the map link
                    } else {
                        console.warn(`Invalid coordinates received for order: ${user.coordinates}`);
                        // Optionally add text indicating coordinates were invalid
                        // messageToOwner += `(Invalid coordinates provided)\n`;
                    }
                } catch (coordError) {
                    console.error("Error processing coordinates:", coordError);
                    // Optionally add text indicating coordinate processing error
                }
                messageToOwner += `📏 *Distance:* ${user.deliveryDistance} km\n`;
                messageToOwner += `💬 *delivery Price:* ${user.deliveryPrice} \n `;



            }
            messageToOwner += "\n🛒 *Items:*\n";
            cart.forEach((item, index) => {
                messageToOwner += `${index + 1}\\. ${sanitizeMarkdownV2(item.name)} \\- ${item.quantity} x ${item.price}₽\n`;

                if (item.size?.name) {
                    messageToOwner += `, ${item.size.name}sm`;
                }

                messageToOwner += "\n";

                if (Array.isArray(item.topping) && item.topping.length > 0) {
                    // Assuming item.topping is an array of strings like ['Cheese', '#Special Spice']
                    const sanitizedToppings = item.topping.map(topping => sanitizeMarkdownV2(String(topping))).join(", "); // Sanitize each one
                    messageToOwner += `    🧀 Toppings: ${sanitizedToppings}\n`; }
            });
            if (user.comment) messageToOwner += `\n💬 *Comment:* ${sanitizeMarkdownV2(user.comment)}\n`;
            messageToOwner += `\n💰 *Total:* ${totalPrice}₽`;

            const inlineKeyboard = [
                [{ text: "✅ Accept", callback_data: `accept_${user.userID}_${databaseOrderID}` }],
                [{ text: "❌ Deny", callback_data: `deny_${user.userID}_${databaseOrderID}` }]
            ];

            const sendPromises = OWNER_CHAT_IDS.map(ownerChatId =>
                bot.sendMessage(ownerChatId, messageToOwner, {
                    parse_mode: "MarkdownV2",
                    reply_markup: { inline_keyboard: inlineKeyboard }
                }).catch(err => console.error(`❌ Failed to send order notification to owner ${ownerChatId}:`, err.message))
            );
            await Promise.all(sendPromises);

            // 7. Respond to Web App
            res.status(201).json({ success: true, message: "✅ Order received and processed.", orderId: databaseOrderID });

        } else {
            console.error("❌ /web-data: Admin server responded unexpectedly:", adminApiResponse.status, adminApiResponse.data);
            res.status(502).json({ error: "❌ Bad response from order processing server." }); // Bad Gateway
        }

    } catch (error) {
        console.error("❌ /web-data: Error processing request:", error.message);
        if (error.response) { // Axios error
            console.error("Admin Server Error:", error.response.status, error.response.data);
            res.status(error.response.status || 500).json({ error: `❌ Admin server error: ${error.response.data?.message || 'Unknown error'}` });
        } else if (error.request) { // No response
            console.error("No response from admin server.");
            res.status(504).json({ error: "❌ No response from admin server (Gateway Timeout)." });
        } else { // Other errors
            next(error); // Pass to global error handler
        }
    }
});

// Broadcast endpoint
app.post("/send-broadcast", requireApiKeyForBot, async (req, res, next) => { // Secure this endpoint
    try {
        const { title, message, imageUrl } = req.body;
        // Removed secretKey check assuming X-API-Key is used now

        if (!title || !message) {
            return res.status(400).json({ message: "❌ Title and message are required!" });
        }
        const users = await botUser.find({ /* Add criteria if needed, e.g., { subscribed: true } */ }, "chatId");
        if (!users.length) {
            return res.status(404).json({ message: "❌ No users found for broadcast!" });
        }
        let successCount = 0;
        const delay = 100; // ms delay

        console.log(`🚀 Starting broadcast to ${users.length} users...`);
        for (const user of users) {
            // Use the dedicated broadcast helper
            const success = await sendBroadcastMessage(user.chatId, title, message, imageUrl);
            if (success) successCount++;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        console.log(`✅ Broadcast finished. Sent to ${successCount} users.`);
        res.json({ message: `✅ Broadcast sent to ${successCount} out of ${users.length} users!` });

    } catch (error) {
        console.error("❌ Broadcast Error:", error);
        next(error);
    }
});

// Notification endpoint (called by admin server)
app.post('/api/notify', requireApiKeyForBot, async (req, res) => {
    const { chatId, message, parseMode } = req.body;
    if (!chatId || !message) {
        console.warn("❌ /api/notify: Missing chatId or message.");
        return res.status(400).json({ message: "Missing 'chatId' or 'message'." });
    }
    console.log(`📬 /api/notify: Received request to send to ${chatId}`);
    try {
        await bot.sendMessage(chatId, message, { parse_mode: parseMode || undefined });
        console.log(`✅ /api/notify: Message sent to ${chatId}.`);
        res.status(200).json({ success: true, message: "Message sent." });
    } catch (error) {
        const errorData = error.response?.data;
        console.error(`❌ /api/notify: Failed to send to ${chatId}:`, errorData || error.message);
        const errorCode = errorData?.error_code;
        const errorDescription = errorData?.description || error.message;
        let statusCode = 500;
        if (errorCode === 400 || errorCode === 403) statusCode = 400; // Bad Request or Forbidden
        res.status(statusCode).json({ success: false, message: `Failed: ${errorDescription}`, errorCode });
    }
});


// --- Telegram Bot Event Handlers ---

bot.onText(/\/start/, async (msg) => {
    const chatId = String(msg.chat.id);
    console.log(`▶️ /start received from chat ID: ${chatId}`);
    const botActive = await isBotWorking();
    if (!botActive) {
        return bot.sendMessage(chatId, "❌ Restaurant hozir ishlamayapti, iltimos keyinroq urinib ko'ring.").catch(err => console.error("Error sending closed message:", err));
    }
    try {
        const user = await botUser.findOne({ chatId });
        if (user?.phone) {
            await bot.sendMessage(chatId, "✅ Siz allaqachon ro'yxatdan o'tgansiz.").catch(err => console.error("Error sending registered message:", err));
        } else {
            await bot.sendMessage(chatId, "Assalomu alaykum! Botdan foydalanish uchun telefon raqamingizni \"Raqamni ulashish\" tugmasi orqali yuboring.", {
                reply_markup: {
                    keyboard: [[{ text: "Raqamni ulashish 📞", request_contact: true }]],
                    one_time_keyboard: true,
                    resize_keyboard: true
                },
            }).catch(err => console.error("Error sending contact request:", err));
        }
    } catch (error) {
        console.error("❌ Error in /start handler:", error);
        await bot.sendMessage(chatId, "❌ Xatolik yuz berdi. Qayta urinib ko'ring.").catch(err => console.error("Error sending start error message:", err));
    }
});

bot.on("contact", async (msg) => {
    if (!msg.contact?.phone_number) {
        console.warn("Received contact message without contact info:", msg);
        return bot.sendMessage(msg.chat.id, "❌ Raqam topilmadi. Iltimos, 'Raqamni ulashish' tugmasini bosing.").catch(err => console.error("Error sending no contact info message:", err));
    }
    const chatId = String(msg.chat.id);
    const username = msg.chat.username || msg.from?.first_name || "Unknown";
    const phoneNumber = msg.contact.phone_number;
    console.log(`📞 Contact received from ${chatId}: ${phoneNumber}`);
    try {
        await botUser.findOneAndUpdate(
            { chatId },
            { $set: { username, phone: phoneNumber } },
            { upsert: true, new: true }
        );
        console.log(`✅ User ${chatId} contact saved/updated.`);
        await bot.sendMessage(chatId, `✅ Rahmat! Raqamingiz (${phoneNumber}) saqlandi.`, {
            reply_markup: { remove_keyboard: true }
        }).catch(err => console.error("Error sending contact saved message:", err));
    } catch (error) {
        console.error("❌ Error saving/updating user contact:", error);
        await bot.sendMessage(chatId, "❌ Raqamingizni saqlashda xatolik yuz berdi.").catch(err => console.error("Error sending contact save error message:", err));
    }
});

// Refactored Callback Query Handler
bot.on("callback_query", async (callbackQuery) => {
    const msg = callbackQuery.message;
    if (!msg) {
        console.error("❌ Callback query without message object:", callbackQuery);
        return bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Message data missing." }).catch(err => console.error("Failed to answer missing msg CBQ:", err));
    }

    const ownerChatId = msg.chat.id;
    const messageId = msg.message_id;
    const data = callbackQuery.data;
    console.log(`▶️ Callback Query Received: ${data} in chat ${ownerChatId}`);

    const parts = data.split("_");
    const action = parts[0];
    const customerChatId = parts[1];
    const databaseOrderID = parts[2];

    if (!action || !customerChatId || !databaseOrderID) {
        console.error("❌ Invalid callback data format:", data);
        return bot.answerCallbackQuery(callbackQuery.id, { text: "Error: Invalid button data." }).catch(err => console.error("Failed to answer invalid data CBQ:", err));
    }

    try {
        await bot.answerCallbackQuery(callbackQuery.id); // Acknowledge

        let success = false;
        let newStatus = null;

        // Handle Order Status Updates
        if (["accept", "deny", "done", "deliver"].includes(action)) {
            switch (action) {
                case "accept": newStatus = 'accepted'; break;
                case "deny": newStatus = 'denied'; break;
                case "done": newStatus = 'ready'; break;
                case "deliver": newStatus = 'completed'; break;
            }
            if (newStatus) {
                success = await updateOrderStatusOnAdminServer(databaseOrderID, newStatus);
            }

            if (success) {
                let updatedKeyboard = [];
                let ownerConfirmationText = `✅ Order ${databaseOrderID.slice(-6)} status: '${newStatus}'.`;
                if (newStatus === 'accepted') {
                    updatedKeyboard = [[{ text: "🏁 Mark Ready", callback_data: `done_${customerChatId}_${databaseOrderID}` }]];
                    ownerConfirmationText = `✅ Order ${databaseOrderID.slice(-6)} accepted!`;
                } else if (newStatus === 'ready') {
                    updatedKeyboard = [[{ text: "🚚 Mark Delivered/Out", callback_data: `deliver_${customerChatId}_${databaseOrderID}` }]];
                    ownerConfirmationText = `🏁 Order ${databaseOrderID.slice(-6)} marked ready!`;
                } else if (newStatus === 'denied') {
                    ownerConfirmationText = `❌ Order ${databaseOrderID.slice(-6)} denied.`;
                } else if (newStatus === 'completed') {
                    ownerConfirmationText = `✅ Order ${databaseOrderID.slice(-6)} completed.`;
                    // Optionally trigger review request from here or admin server
                    await bot.sendMessage(customerChatId, "⭐ Buyurtmangizdan mamnun bo'ldingizmi? Iltimos, baho bering!", {
                        reply_markup: {
                            inline_keyboard: [[
                                { text: "1⭐", callback_data: `review_1_${databaseOrderID}_${customerChatId}_${ownerChatId}` },
                                { text: "2⭐", callback_data: `review_2_${databaseOrderID}_${customerChatId}_${ownerChatId}` },
                                { text: "3⭐", callback_data: `review_3_${databaseOrderID}_${customerChatId}_${ownerChatId}` },
                                { text: "4⭐", callback_data: `review_4_${databaseOrderID}_${customerChatId}_${ownerChatId}` },
                                { text: "5⭐", callback_data: `review_5_${databaseOrderID}_${customerChatId}_${ownerChatId}` }
                            ]]
                        }
                    }).catch(err => console.error("Error sending review request:", err));
                }

                await bot.sendMessage(ownerChatId, ownerConfirmationText).catch(err => console.error("Error sending owner confirmation:", err));
                await bot.editMessageReplyMarkup({ inline_keyboard: updatedKeyboard }, { chat_id: ownerChatId, message_id: messageId }).catch(err => console.error("Error editing owner message markup:", err));

            } else if (newStatus) { // Only send failure if an update was attempted
                console.error(`API call failed for action '${action}', order ${databaseOrderID}`);
                await bot.sendMessage(ownerChatId, `⚠️ Failed to update order ${databaseOrderID.slice(-6)} status to '${newStatus}'.`).catch(err => console.error("Error sending owner API failure message:", err));
            }
        }
        // Handle Review Action
        else if (action === "review") {
            const rating = parts[1];
            const reviewCustomerID = parts[3];
            const reviewOwnerID = parts[4];
            const ratingNumber = parseInt(rating, 10);

            if (isNaN(ratingNumber) || ratingNumber < 1 || ratingNumber > 5) {
                console.error("Invalid rating received:", rating); return;
            }

            success = await sendReviewToAdminServer(databaseOrderID, ratingNumber);

            if (success) {
                await bot.sendMessage(reviewCustomerID, `🎉 Rahmat! Siz ${rating}⭐ baho berdingiz.`);
                if (callbackQuery.message?.chat?.id.toString() === reviewCustomerID) {
                    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: reviewCustomerID, message_id: callbackQuery.message.message_id }).catch(err => console.error("Error editing customer review msg:", err));
                }
                await bot.sendMessage(reviewOwnerID, `📢 Yangi baho:\n🛒 Buyurtma #${databaseOrderID.slice(-6)}\n⭐ Baho: ${rating} yulduz`).catch(err => console.error("Error sending review notification to owner:", err));
            } else {
                await bot.sendMessage(reviewCustomerID, `⚠️ Sharhingizni yuborishda xatolik yuz berdi.`).catch(err => console.error("Error sending review failure msg:", err));
            }
        }
        // Handle Unknown Actions
        else {
            console.warn(`❓ Unknown callback action received: ${action}`);
        }
    } catch (error) {
        console.error(`❌ Error processing callback query (${data}):`, error.message);
    }
});

// General message handler (for debugging or non-command messages)
bot.on("message", (msg) => {
    if (msg.text?.startsWith('/') || msg.contact || msg.web_app_data) return; // Ignore commands, contacts, webapp data already handled
    console.log(`📩 General message from ${msg.chat.id}:`, msg.text);
    // Add logic here if you want to respond to general text messages
});

// --- Error Handlers for Express ---
// 404 Handler (after all routes)
app.use((req, res, next) => {
    res.status(404).json({ error: `Not Found - ${req.originalUrl}` });
});

// Global Error Handler (last middleware)
app.use((err, req, res, next) => {
    console.error("💥 Global Express Error Handler:", err.stack);
    const statusCode = err.status || 500;
    res.status(statusCode).json({
        error: process.env.NODE_ENV === 'production' ? "Internal Server Error" : err.message
    });
});

// --- Start Server --- (Moved inside connectDB().then())
// app.listen(BOT_SERVER_PORT, "0.0.0.0", () => console.log(`🚀 Bot Server running on port ${BOT_SERVER_PORT}`));

