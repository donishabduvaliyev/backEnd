import { Schema, model } from "mongoose";




const ProductSchema = new Schema({
    categories: [String], // Array of categories
    items: [
        {
            name: String,
            price: Number,
            image: String,
            isAviable: Boolean,
            category: String,
            toppings: [
                {
                    name: String,
                    price: Number
                }

            ],
            sizes: []
        }
    ]
});


export default model("Product", ProductSchema, "productData");


