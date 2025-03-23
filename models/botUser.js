import mongoose from "mongoose";

const BotUserSchema = new mongoose.Schema({
    chatId: { type: String, required: true, unique: true },
    username: { type: String },
    phone: { type: String, required: true },
});

export default mongoose.model("botUser", BotUserSchema, "botUsers");
