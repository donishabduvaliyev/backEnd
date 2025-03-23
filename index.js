import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./config.js";
import Product from "./models/Product.js";
import TelegramBot from "node-telegram-bot-api";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { log } from "console";
import botUser from "./models/botUser.js";

dotenv.config();

const app = express();
app.use(bodyParser.json());

const SECRET_KEY = process.env.SECRET_KEY


const allowedOrigins = [
    "http://localhost:5174",
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

const deleteWebhook = async () => {
    try {
        const response = await fetch(`https://api.telegram.org/bot${TOKEN}/deleteWebhook`);
        // console.log("✅ Webhook deleted:", await response.json());
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

    // Check if user already exists
    const existingUser = await botUser.findOne({ chatId });

    if (existingUser) {
        bot.sendMessage(chatId, "✅ You are already registered!");
        return;
    }

    // Ask for phone number
    bot.sendMessage(chatId, "📲 Please share your phone number to register.", {
        reply_markup: {
            keyboard: [[{ text: "Share Phone Number 📞", request_contact: true }]],
            one_time_keyboard: true,
        },
    });
});


bot.on("contact", async (msg) => {
    const chatId = String(msg.chat.id);
    const username = msg.chat.username || "Unknown";
    const phoneNumber = msg.contact.phone_number;

    try {
        // Save user to MongoDB
        await botUser.findOneAndUpdate(
            { chatId },
            { username, phone: phoneNumber },
            { upsert: true, new: true }
        );

        bot.sendMessage(chatId, "✅ Registration successful! Thank you.");
    } catch (error) {
        console.error("❌ Error saving user:", error);
        bot.sendMessage(chatId, "❌ An error occurred. Please try again.");
    }
});

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
            // console.log(`✅ Saved Contact: ${chatId} => ${msg.contact.phone_number}`);
        } catch (error) {
            console.error("❌ Failed to save contact:", error);
        }

        bot.sendMessage(msg.chat.id, `✅ Phone number saved: ${msg.contact.phone_number}`);
    } else {
        bot.sendMessage(msg.chat.id, "❌ No phone number found.");
    }
});


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

const userOrders = new Map();

app.use(express.json()); // ✅ Ensures JSON request body is parsed
app.use(express.urlencoded({ extended: true })); // ✅ Parses URL-encoded data


app.post("/web-data", async (req, res) => {
    try {
        const data = req.body;
        console.log("📩 Received order data from frontend:", data);
      


        const user = data.user;
        const cart = data.cart;
        // console.log(user.userID.chatID);
        const userChatIDfromWEB = user.userID
        const orderID = data.orderID.id
        const TotalPrice = data.orderID.price


        let message = `📝  #${orderID} Order from ${user.name}\n📞 Phone: ${user.phone}\n📍 Delivery Type: ${user.deliveryType}`;

        // ✅ Check if `coordinates` exist and are in correct format
        // if (user.deliveryType === "delivery" && user.coordinates) {
        //     let latitude, longitude;

        //     if (Array.isArray(user.coordinates) && user.coordinates.length === 2) {
        //         // Case 1: If coordinates are an array: [latitude, longitude]
        //         [latitude, longitude] = user.coordinates;
        //     } else if (typeof user.coordinates === "string" && user.coordinates.includes(",")) {
        //         // Case 2: If coordinates are a string: "latitude,longitude"
        //         [latitude, longitude] = user.coordinates.split(",");
        //     } else {
        //         console.error("❌ Invalid coordinates format:", user.coordinates);
        //         latitude = longitude = null;
        //     }

        //     if (latitude && longitude) {
        //         const mapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
        //         message += `\n📌 Manzil: ${user.location}`;
        //         message += `\n📍 [📍 Xaritadan ko'rish](${mapsLink})`;  // Clickable link
        //     } else {
        //         message += `\n📌 Manzil: ${user.location} (Invalid coordinates)`;
        //     }
        // }


        // message += `\n🛒 Buyurtma:\n`;

        // cart.forEach((item, index) => {
        //     message += `${index + 1}. ${item.name} - ${item.quantity} x ${item.price}₽\n`;
        //     message += `${item.toppings.map((topping, index) => {
        //         index, topping
        //     })}`

        // });


        // if (user.comment) {
        //     message += `💬 Kommentariya: ${user.comment}`;
        // }





        // message += `Jami narx: ${TotalPrice
        //     } `


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
                message += `\n📌 Manzil: ${user.location}`;
                message += `\n📍 [📍 Xaritadan ko'rish](${mapsLink})`;  // Clickable link
            } else {
                message += `\n📌 Manzil: ${user.location} (Invalid coordinates)`;
            }
        }

        message += "\n🛒 Order Items:\n";
        cart.forEach((item, index) => {
            message += `${index + 1}. ${item.name} - ${item.quantity} x ${item.price}₽\n , ${item.size}sm`;
           
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
                            [{ text: "✅ Accept Order", callback_data: `accept_${userChatIDfromWEB}_${orderID}` }],
                            [{ text: "❌ Deny Order", callback_data: `deny_${userChatIDfromWEB}_${orderID} ` }]
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
    const messageId = msg.message_id;
    const data = callbackQuery.data

    const action = data.split("_")[0]




    const customerChatId = callbackQuery.data.split("_")[1];
    const OrderID = callbackQuery.data.split("_")[2]

    if (!customerChatId) {
        console.error("❌ Customer chat ID missing:", callbackQuery.data);
        return;
    }



    try {
        switch (action) {
            case "accept":
                bot.sendMessage(chatId, `✅ Order ${OrderID} accepted!`);
                bot.sendMessage(customerChatId, "✅ Sizning buyurtmangiz qabul qilindi!");
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
                bot.sendMessage(customerChatId, "✅ Sizning buyurtmangiz tayyor va tez orada yetkaziladi");
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
                break;
        }
    } catch (error) {
        console.error("❌ Error handling callback query:", error);
    }
});




const sendMessage = async (chatId, title, message, imageUrl) => {
    try {
        // Sending text message
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text: `📢 *${title}*\n\n${message}`,
            parse_mode: "Markdown",
        });

        // Sending image if provided
        if (imageUrl) {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
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

/**
 * @route POST /send-broadcast
 * @desc Send broadcast message to all users
 */
router.post("/send-broadcast", async (req, res) => {
    try {
        const { title, message, imageUrl, secretKey } = req.body;

        // ✅ Security Check
        if (secretKey !== SECRET_KEY) {
            return res.status(403).json({ message: "❌ Unauthorized request" });
        }

        // ✅ Validate Inputs
        if (!title || !message) {
            return res.status(400).json({ message: "❌ Title and message are required!" });
        }

        // ✅ Fetch all bot users from the database
        const users = await botUser.find({}, "chatId");
        if (!users.length) {
            return res.status(404).json({ message: "❌ No users found to send broadcast!" });
        }

        // ✅ Send messages to each user
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