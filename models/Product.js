const mongoose = require("mongoose");

// Item Schema
const itemSchema = new mongoose.Schema({
    id: String, 
    name: String,
    price: Number,
    image: String,
    category: String,
    toppings: [{
        name: String,
        price: Number
    }]
}, { _id: false }); 


const ProductSchema = new mongoose.Schema({
    title: String,
    id: String,
    items: [itemSchema] 
});

module.exports = mongoose.model("Product", ProductSchema, "products-data");
