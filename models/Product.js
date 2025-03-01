import { Schema, model } from "mongoose";

// Item Schema
const itemSchema = new Schema({
    id: String, 
    name: String,
    price: Number,
    image: String,
    category: String,
    toppings: [{
        name: String,
        price: Number
    }],
    size: Number
}, { _id: false }); 


const ProductSchema = new Schema({
    title: String,
    id: String,
    items: [itemSchema] 
});


export default model("Product", ProductSchema, "productData");
