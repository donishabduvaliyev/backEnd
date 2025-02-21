// const express = require("express");
// const bodyParser = require("body-parser");
// const cors = require("cors");
// const { userInfo } = require("os");
// require('dotenv').config();





// // const app = express();   
// // app.use(bodyParser.json());
// // app.use(cors({ origin: "http://localhost:5173" }));


// // console.log("Bot Token:", process.env.TELEGRAM_BOT_TOKEN);





// // ✅ Start Command



// // ✅ Handle Contact Sharing
// // const userContacts = new Map(); // Temporary storage for phone numbers

// // // ✅ Handle Contact Sharing & Store in Memory
// // bot.on("contact", (msg) => {
// //     console.log("📩 Received Contact Data:", msg);

// //     if (msg.contact && msg.contact.phone_number) {
// //         const chatId = String(msg.chat.id); // Store as a string
// //         userContacts.set(chatId, msg.contact.phone_number);

// //         // Save to JSON file
// //         fs.writeFileSync(CONTACTS_FILE, JSON.stringify(Object.fromEntries(userContacts)));

// //         console.log(`✅ Saved Contact: ${chatId} => ${msg.contact.phone_number}`);
// //         console.log("📦 Contacts Updated:", [...userContacts.entries()]);

// //         bot.sendMessage(msg.chat.id, `✅ Your phone number has been saved: ${msg.contact.phone_number}`);
// //     } else {
// //         console.log("❌ No phone number found in message.");
// //     }
// // });







// // ✅ Fix: Handle WebApp Data Correctly


// // ✅ Express API Routes
// app.get("/", (req, res) => {
//     res.send("Server is running!");
// });

// app.post("/send-message", (req, res) => {
//     const { chatId, message } = req.body;

//     if (!chatId || !message) {
//         return res.status(400).json({ error: "Missing chatId or message" });
//     }

//     console.log("Sending message to chatId:", chatId);

//     bot.sendMessage(chatId, message)
//         .then(() => res.json({ success: true }))
//         .catch(err => res.status(500).json({ error: err.message }));
// });

// // ✅ Start the Server
// const PORT = 5000;
// app.listen(PORT, () => {
//     console.log(`Server running on http://localhost:${PORT}`);
// });





// app.get("/get-phone/:chatId", (req, res) => {
//     const chatId = String(req.params.chatId);
//     console.log(`📤 Fetching Phone Number for Chat ID: ${chatId}`);

//     if (!userContacts.has(chatId)) {
//         console.log(`❌ Phone number not found for Chat ID: ${chatId}`);
//         return res.status(404).json({ error: "Phone number not found" });
//     }

//     const phoneNumber = userContacts.get(chatId);
//     console.log(`✅ Phone Number Found: ${phoneNumber}`);
//     res.json({ phoneNumber });
// });











// const mongoose = require("mongoose");
// require("dotenv").config();

// const Product = require("./models/Product");  // Import Product Model

// const MONGO_URI = process.env.MONGO_URI;
// if (!MONGO_URI) {
//     console.error("❌ MONGO_URI is not defined. Check your .env file.");
//     process.exit(1); // Stop the server if no URI is found
// }

// console.log(Product.find());

// // ✅ Connect to MongoDB
// mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
//     .then(() => console.log("✅ mongoDB is aviable"))
//     .catch(err => console.error("❌ MongoDB Error:", err));

// // ✅ Fetch All Products
// app.get("/api/products", async (req, res) => {
//     try {
//         const products = await Product.find();
        
//         res.json(products);
//     } catch (error) {
//         res.status(500).json({ error: error.message });
//     }
// });

// // ✅ Add New Product
// // app.post("/products", async (req, res) => {
// //     try {
// //         const { name, price, imageUrl } = req.body;
// //         const newProduct = new Product({ name, price, imageUrl });

// //         await newProduct.save();
// //         res.json(newProduct);
// //     } catch (error) {
// //         res.status(500).json({ error: error.message });
// //     }
// // });

// // // ✅ Start Server
// // const PORT = process.env.PORT || 5000;
// // app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
