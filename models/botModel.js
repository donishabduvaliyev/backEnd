import mongoose from "mongoose";

const scheduleSchema = new mongoose.Schema({
    startHour: { type: Number, required: true },
    endHour: { type: Number, required: true },
});

const botScheduleSchema = new mongoose.Schema({
    schedule: {
        Dushanba: scheduleSchema,
        Seshanba: scheduleSchema,
        Chorshanba: scheduleSchema,
        Payshanba: scheduleSchema,
        Juma: scheduleSchema,
        Shanba: scheduleSchema,
        Yakshanba: scheduleSchema,
    },
    isEmergencyOff: { type: Boolean, default: false }, // Bot off in emergencies
    updatedAt: { type: Date, default: Date.now }
});

// Model for MongoDB
const BotSchedule = mongoose.model("BotSchedule", botScheduleSchema , "botEdit");

export default BotSchedule;
