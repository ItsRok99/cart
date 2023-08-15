const express = require("express");
const bodyParser = require("body-parser");
const { MongoClient, ObjectId } = require("mongodb");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const env = require("dotenv").config();
const util = require('util');
const amqp = require('amqplib/callback_api');
const axios = require('axios');
const cors = require('cors');
const jwt = require('jsonwebtoken');

// -------------------------------------------------------
// vse localhoste zamenjas z 127...
// izklopi pozarni zid!
// -------------------------------------------------------


const app = express();
app.use(bodyParser.json());

app.use(cors());

const authorize = require('./middleware/authorization');
const { Console } = require("console");

// MongoDB connection string
// const uri = "mongodb://localhost:27017"; 
const uri = "mongodb+srv://Rok:Feri123!@cluster0.bkl6gj5.mongodb.net/cart";

// Database and collection names
const dbName = "cartDB";
const collectionName = "carts";

// RabbitMQ connection details
const rabbitUser = "student";
const rabbitPassword = "student123";
const rabbitHost = "studentdocker.informatika.uni-mb.si";
// const rabbitHost = "rabbit";
const rabbitPort = "5672";
const vhost = "";
const amqpUrl = util.format("amqp://%s:%s@%s:%s/%s", rabbitUser, rabbitPassword, rabbitHost, rabbitPort, vhost);

// RabbitMQ Exchange, Queue, and Routing key
const exchange = 'upp-3';
const queue = 'upp-3';
const routingKey = 'zelovarnikey';

const jwtAuth = async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'Missing Authorization header' });
      }
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.SECRET_KEY);
      req.user = decoded;
      next();
    } catch (err) {
      console.error('Error verifying token:', err.message);
      return res.status(403).json({ error: 'Invalid token' });
    }
  };

function publishLog(log) {
    amqp.connect(amqpUrl, { heartbeat: 60 }, (error, connection) => {
        if (error) {
            console.error("Error connecting to RabbitMQ:", error);
            return;
        }
        connection.createChannel((error, channel) => {
            if (error) {
                console.error("Error creating RabbitMQ channel:", error);
                return;
            }

            channel.assertExchange(exchange, 'direct', { durable: true });
            channel.assertQueue(queue, { durable: true });
            channel.bindQueue(queue, exchange, routingKey);

            channel.publish(exchange, routingKey, Buffer.from(log));

            setTimeout(() => {
                channel.close();
                connection.close();
            }, 500);
        });
    });
}

// Connect to MongoDB
MongoClient.connect(uri, { useUnifiedTopology: true })
    .then((client) => {
        console.log("Connected to MongoDB");
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        // Swagger setup
        const swaggerDocument = YAML.load("./swagger.yaml");
        app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Create a new cart
app.post("/carts", jwtAuth, (req, res) => {
    const { user_id, products_id } = req.body;
    const cart = { user_id, products_id };
    const correlationId = req.headers["x-correlation-id"] || new ObjectId().toString();

    const bearer = req.headers["authorization"];
    axios.defaults.headers.common['authorization'] = bearer;

    // Check if user exists
    axios.get(`http://127.0.0.1:8000/users/${user_id}`,)
        .then((userResponse) => {
            const user = userResponse.data;

            if (!user) {
                const log = `${new Date().toISOString()} ERROR http://cart:3032/cart CorrelationId: ${correlationId} [cart-service] - User not found.`;
                publishLog(log);
                return res.status(404).json({ error: "User not found" });
            }

            // Check if product exists
            axios.get(`http://127.0.0.1:3000/products/${products_id}`)
                .then((productResponse) => {
                    const product = productResponse.data;

                    if (!product) {
                        const log = `${new Date().toISOString()} ERROR http://cart:3032/cart CorrelationId: ${correlationId} [cart-service] - Product not found.`;
                        publishLog(log);
                        return res.status(404).json({ error: "Product not found" });
                    }

                    collection
                        .insertOne(cart)
                        .then((result) => {
                            const log = `${new Date().toISOString()} INFO http://cart:3032/cart CorrelationId: ${correlationId} [cart-service] - Successfully created a cart.`;
                            publishLog(log);
                            console.log("Inserted cart:");
                            res.status(201).json(JSON.stringify(result));

                            // Send statistics request to Heroku app
                            // axios.post('https://statistics-service-api.herokuapp.com/add-statistic', { service: "Cart", endpoint: "create" })
                            axios.post('https://statistics-app-cc50d2934119.herokuapp.com/add-statistic', { service: "Cart", endpoint: "create" })
                                .then(() => {
                                    console.log("Statistics sent successfully.");
                                })
                                .catch((error) => {
                                    console.error("Failed to send statistics:", error);
                                });

                        })
                        .catch((error) => {
                            const log = `${new Date().toISOString()} ERROR http://cart:3032/cart CorrelationId: ${correlationId} [cart-service] - Failed to create a cart.`;
                            publishLog(log);
                            console.error("Error creating cart:", error);
                            res.status(500).json({ error: "Failed to create cart" });
                        });
                })
                .catch((error) => {
                    const log = `${new Date().toISOString()} ERROR http://cart:3032/cart CorrelationId: ${correlationId} [cart-service] - Failed to fetch product data from product service.`;
                    publishLog(log);
                    console.error("Error fetching product data:", error);
                    res.status(500).json({ error: "Failed to fetch product data" });
                });
        })
        .catch((error) => {
            const log = `${new Date().toISOString()} ERROR http://cart:3032/cart CorrelationId: ${correlationId} [cart-service] - Failed to fetch user data from user service.`;
            publishLog(log);
            console.error("Error fetching user data:", error);
            res.status(500).json({ error: "Failed to fetch user data" });
        });
});

// Get cart by user_id
app.get("/carts/user/:user_id", jwtAuth, (req, res) => {
    const { user_id } = req.params;
    const correlationId = req.headers["x-correlation-id"] || new ObjectId().toString();

    // xxx
    const bearer = req.headers["authorization"];
    axios.defaults.headers.common['authorization'] = bearer;

    // Fetch user data from the user service
    axios.get(`https://user-xojp.onrender.com/users/${user_id}`)
        .then((response) => {
            const user = response.data;

            if (!user) {
                const log = `${new Date().toISOString()} ERROR http://cart:3032/cart/user/${user_id} CorrelationId: ${correlationId} [cart-service] - User not found.`;
                publishLog(log);
                return res.status(404).json({ error: "User not found" });
            }

            collection
                .findOne({ user_id })
                .then((cart) => {
                    if (cart) {
                        const log = `${new Date().toISOString()} INFO http://cart:3032/cart/user/${user_id} CorrelationId: ${correlationId} [cart-service] - Successfully retrieved cart by userId.`;
                        publishLog(log);
                        res.json(cart);

                        // Send statistics request to Heroku app
                        // axios.post('https://statistics-service-api.herokuapp.com/add-statistic', { service: "Cart", endpoint: "get" })
                        axios.post('https://statistics-app-cc50d2934119.herokuapp.com/add-statistic', { service: "Cart", endpoint: "get-by-user-id" })
                            .then(() => {
                                console.log("Statistics sent successfully.");
                            })
                            .catch((error) => {
                                console.error("Failed to send statistics:", error);
                            });
                    } else {
                        const log = `${new Date().toISOString()} ERROR http://cart:3032/cart/user/${user_id} CorrelationId: ${correlationId} [cart-service] - Cart not found.`;
                        publishLog(log);
                        res.status(404).json({ error: "Cart not found" });
                    }
                })
                .catch((error) => {
                    const log = `${new Date().toISOString()} ERROR http://cart:3032/cart/user/${user_id} CorrelationId: ${correlationId} [cart-service] - Failed to retrieve cart.`;
                    publishLog(log);
                    console.error("Error retrieving cart:", error);
                    res.status(500).json({ error: "Failed to retrieve cart" });
                });
        })
        .catch((error) => {
            const log = `${new Date().toISOString()} ERROR http://cart:3032/cart/user/${user_id} CorrelationId: ${correlationId} [cart-service] - Failed to fetch user data from user service.`;
            publishLog(log);
            console.error("Error fetching user data:", error);
            res.status(500).json({ error: "Failed to fetch user data" });
        });
});



        // Get a single cart by ID
        app.get("/carts/:id", jwtAuth, (req, res) => {
            const cartId = new ObjectId(req.params.id);
            const correlationId = req.headers['x-correlation-id'] || new ObjectId().toString();

            collection
                .findOne({ _id: cartId })
                .then((cart) => {
                    if (cart) {
                        const log = `${new Date().toISOString()} INFO http://cart:3032/cart/${cartId} CorrelationId: ${correlationId} [cart-service] - Successfully retrieved cart.`;
                        publishLog(log);
                        res.json(cart);

                        // Send statistics request to Heroku app
                        // axios.post('https://statistics-service-api.herokuapp.com/add-statistic', { service: "Cart", endpoint: "get" })
                        axios.post('https://statistics-app-cc50d2934119.herokuapp.com/add-statistic', { service: "Cart", endpoint: "get-by-id" })
                        
                            .then(() => {
                                console.log("Statistics sent successfully.");
                            })
                            .catch((error) => {
                                console.error("Failed to send statistics:", error);
                            });

                    } else {
                        const log = `${new Date().toISOString()} ERROR http://cart:3032/cart/${cartId} CorrelationId: ${correlationId} [cart-service] - Cart not found.`;
                        publishLog(log);
                        res.status(404).json({}); // Return an empty response with 404 status code
                    }
                })
                .catch((error) => {
                    const log = `${new Date().toISOString()} ERROR http://cart:3032/cart/${cartId} CorrelationId: ${correlationId} [cart-service] - Failed to retrieve cart.`;
                    publishLog(log);
                    console.error("Error retrieving cart:", error);
                    res.status(500).json({ error: "Failed to retrieve cart" });
                });
        });


// Update a cart
app.put("/carts/:id", jwtAuth, (req, res) => {
    const cartId = new ObjectId(req.params.id);
    const { user_id, products_id } = req.body;
    const updatedCart = { user_id, products_id };
    const correlationId = req.headers["x-correlation-id"] || new ObjectId().toString();

    const bearer = req.headers["authorization"];
    axios.defaults.headers.common['authorization'] = bearer;

    // Check if user exists
    axios.get(`http://127.0.0.1:8000/users/${user_id}`)
        .then((userResponse) => {
            const user = userResponse.data;

            if (!user) {
                const log = `${new Date().toISOString()} ERROR http://cart:3032/cart/${cartId} CorrelationId: ${correlationId} [cart-service] - User not found.`;
                publishLog(log);
                return res.status(404).json({ error: "User not found" });
            }

            if (products_id.length == 0){
                collection
                        .findOneAndUpdate(
                            { _id: cartId },
                            { $set: updatedCart },
                            { returnOriginal: false }
                        )
                        .then((result) => {
                            console.log("Result:", result.value);
                            if (result.value) {
                                const log = `${new Date().toISOString()} INFO http://cart:3032/cart/${cartId} CorrelationId: ${correlationId} [cart-service] - Cart updated successfully.`;
                                publishLog(log);
                                res.json(result.value);

                                // Send statistics request to Heroku app
                                // axios.post('https://statistics-service-api.herokuapp.com/add-statistic', { service: "Cart", endpoint: "update" })
                                axios.post('https://statistics-app-cc50d2934119.herokuapp.com/add-statistic', { service: "Cart", endpoint: "update" })
                                    .then(() => {
                                        console.log("Statistics sent successfully.");
                                    })
                                    .catch((error) => {
                                        console.error("Failed to send statistics:", error);
                                    });

                            } else {
                                const log = `${new Date().toISOString()} ERROR http://cart:3032/cart/${cartId} CorrelationId: ${correlationId} [cart-service] - Cart not found.`;
                                publishLog(log);
                                console.log("Cart not found!!!!!!!!!!!!!!!");
                                res.status(404).json({ error: "Cart not found" });
                            }
                        })
                        .catch((error) => {
                            const log = `${new Date().toISOString()} ERROR http://cart:3032/cart/${cartId} CorrelationId: ${correlationId} [cart-service] - Failed to update cart.`;
                            publishLog(log);
                            console.error("Error updating cart:", error);
                            res.status(500).json({ error: "Failed to update cart" });
                        });
            }
            else {
                axios.get(`http://127.0.0.1:3000/products/${products_id[products_id.length - 1]}`)
                .then((productResponse) => {
                    const product = productResponse.data;

                    if (!product) {
                        const log = `${new Date().toISOString()} ERROR http://cart:3032/cart/${cartId} CorrelationId: ${correlationId} [cart-service] - Product not found.`;
                        publishLog(log);
                        return res.status(404).json({ error: "Product not found" });
                    }

                    console.log("Cart ID:", cartId);

                    collection
                        .findOneAndUpdate(
                            { _id: cartId },
                            { $set: updatedCart },
                            { returnOriginal: false }
                        )
                        .then((result) => {
                            console.log("Result:", result.value);
                            if (result.value) {
                                const log = `${new Date().toISOString()} INFO http://cart:3032/cart/${cartId} CorrelationId: ${correlationId} [cart-service] - Cart updated successfully.`;
                                publishLog(log);
                                res.json(result.value);

                                // Send statistics request to Heroku app
                                axios.post('https://statistics-service-api.herokuapp.com/add-statistic', { service: "Cart", endpoint: "update" })
                                    .then(() => {
                                        console.log("Statistics sent successfully.");
                                    })
                                    .catch((error) => {
                                        console.error("Failed to send statistics:", error);
                                    });

                            } else {
                                const log = `${new Date().toISOString()} ERROR http://cart:3032/cart/${cartId} CorrelationId: ${correlationId} [cart-service] - Cart not found.`;
                                publishLog(log);
                                console.log("Cart not found!!!!!!!!!!!!!!!");
                                res.status(404).json({ error: "Cart not found" });
                            }
                        })
                        .catch((error) => {
                            const log = `${new Date().toISOString()} ERROR http://cart:3032/cart/${cartId} CorrelationId: ${correlationId} [cart-service] - Failed to update cart.`;
                            publishLog(log);
                            console.error("Error updating cart:", error);
                            res.status(500).json({ error: "Failed to update cart" });
                        });
                })
                .catch((error) => {
                    const log = `${new Date().toISOString()} ERROR http://cart:3032/cart/${cartId} CorrelationId: ${correlationId} [cart-service] - Failed to fetch product data from product service.`;
                    publishLog(log);
                    console.error("Error fetching product data:", error);
                    res.status(500).json({ error: "Failed to fetch product data" });
                });
            }
            
        })
        .catch((error) => {
            const log = `${new Date().toISOString()} ERROR http://cart:3032/cart/${cartId} CorrelationId: ${correlationId} [cart-service] - Failed to fetch user data from user service.`;
            publishLog(log);
            console.error("Error fetching user data:", error);
            res.status(500).json({ error: "Failed to fetch user data" });
        });
});


        // Get all carts
        app.get("/carts", jwtAuth, (req, res) => {
            const correlationId = req.headers['x-correlation-id'] || new ObjectId().toString();

            collection
                .find({})
                .toArray()
                .then((carts) => {
                    const log = `${new Date().toISOString()} INFO http://cart:3032/cart CorrelationId: ${correlationId} [cart-service] - Successfully retrieved carts.`;
                    publishLog(log);
                    res.json(carts);

                    // Send statistics request to Heroku app
                    // axios.post('https://statistics-service-api.herokuapp.com/add-statistic', { service: "Cart", endpoint: "get-all" })
                    axios.post('https://statistics-app-cc50d2934119.herokuapp.com/add-statistic', { service: "Cart", endpoint: "get-all" })
                        .then(() => {
                            console.log("Statistics sent successfully.");
                        })
                        .catch((error) => {
                            console.error("Failed to send statistics:", error);
                        });
                })
                .catch((error) => {
                    const log = `${new Date().toISOString()} ERROR http://cart:3032/cart CorrelationId: ${correlationId} [cart-service] - Failed to retrieve carts.`;
                    publishLog(log);
                    console.error("Error retrieving carts:", error);
                    res.status(500).json({ error: "Failed to retrieve carts" });
                });
        });

        // Delete a cart
        app.delete("/carts/:id", jwtAuth, (req, res) => {
            const cartId = new ObjectId(req.params.id);
            const correlationId = req.headers['x-correlation-id'] || new ObjectId().toString();

            collection
                .findOneAndDelete({ _id: cartId })
                .then((result) => {
                    if (result.value) {
                        const log = `${new Date().toISOString()} INFO http://cart:3032/cart/${cartId} CorrelationId: ${correlationId} [cart-service] - Cart deleted successfully.`;
                        publishLog(log);
                        res.json({ message: "Cart deleted successfully" });

                        // Send statistics request to Heroku app
                        // axios.post('https://statistics-service-api.herokuapp.com/add-statistic', { service: "Cart", endpoint: "delete" })
                        axios.post('https://statistics-app-cc50d2934119.herokuapp.com/add-statistic', { service: "Cart", endpoint: "delete" })
                            .then(() => {
                                console.log("Statistics sent successfully.");
                            })
                            .catch((error) => {
                                console.error("Failed to send statistics:", error);
                            });

                    } else {
                        const log = `${new Date().toISOString()} ERROR http://cart:3032/cart/${cartId} CorrelationId: ${correlationId} [cart-service] - Cart not found.`;
                        publishLog(log);
                        res.status(404).json({ error: "Cart not found" });
                    }
                })
                .catch((error) => {
                    const log = `${new Date().toISOString()} ERROR http://cart:3032/cart/${cartId} CorrelationId: ${correlationId} [cart-service] - Failed to delete cart.`;
                    publishLog(log);
                    console.error("Error deleting cart:", error);
                    res.status(500).json({ error: "Failed to delete cart" });
                });
        });

        //delete all carts
        app.delete("/carts", jwtAuth, (req, res) => {
            const correlationId = req.headers['x-correlation-id'] || new ObjectId().toString();

            collection.deleteMany({})
                .then((result) => {
                    const log = `${new Date().toISOString()} INFO http://cart:3032/cart/ CorrelationId: ${correlationId} [cart-service] - Carts deleted successfully.`;
                    publishLog(log);
                    res.json({ message: "All carts deleted successfully" });

                    // Send statistics request to Heroku app
                    // axios.post('https://statistics-service-api.herokuapp.com/add-statistic', { service: "Cart", endpoint: "delete" })
                    axios.post('https://statistics-app-cc50d2934119.herokuapp.com/add-statistic', { service: "Cart", endpoint: "delete-all" })
                        .then(() => {
                            console.log("Statistics sent successfully.");
                        })
                        .catch((error) => {
                            console.error("Failed to send statistics:", error);
                        });
                })
                .catch((error) => {
                    const log = `${new Date().toISOString()} ERROR http://cart:3032/cart/ CorrelationId: ${correlationId} [cart-service] - Failed to delete carts.`;
                    publishLog(log);
                    console.error("Error deleting carts:", error);
                    res.status(500).json({ error: "Failed to delete carts" });
                });
        });

// Get cart by product ID
app.get("/carts/product/:productId", jwtAuth, (req, res) => {
    const productId = req.params.productId;
    const correlationId = req.headers["x-correlation-id"] || new ObjectId().toString();

    // Dodaj ko se povezuje drugam
    const bearer = req.headers["authorization"];
    axios.defaults.headers.common['authorization'] = bearer;
    // console.log("header:" , req.headers);
    // console.log("bearer: " , bearer);

    // Fetch product data from the product service
    axios.get(`http://127.0.0.1:3000/products/${productId}`)
        .then((response) => {
            const product = response.data;

            if (!product) {
                const log = `${new Date().toISOString()} ERROR http://cart:3032/carts/product/${productId} CorrelationId: ${correlationId} [cart-service] - Product not found.`;
                publishLog(log);
                return res.status(404).json({ error: "Product not found" });
            }

            collection
                .find({ products_id: productId })
                .toArray()
                .then((carts) => {
                    const log = `${new Date().toISOString()} INFO http://cart:3032/carts/product/${productId} CorrelationId: ${correlationId} [cart-service] - Successfully retrieved carts by product ID.`;
                    publishLog(log);
                    res.json(carts);

                    // Send statistics request to Heroku app 
                    // axios.post('https://statistics-service-api.herokuapp.com/add-statistic', { service: "Cart", endpoint: "get-by-product-id" })
                    axios.post('https://statistics-app-cc50d2934119.herokuapp.com/add-statistic', { service: "Cart", endpoint: "get-by-product-id" })
                        .then(() => {
                            console.log("Statistics sent successfully.");
                        })
                        .catch((error) => {
                            console.error("Failed to send statistics:", error);
                        });
                })
                .catch((error) => {
                    const log = `${new Date().toISOString()} ERROR http://cart:3032/carts/product/${productId} CorrelationId: ${correlationId} [cart-service] - Failed to retrieve carts by product ID.`;
                    publishLog(log);
                    console.error("Error retrieving carts by product ID:", error);
                    res.status(500).json({ error: "Failed to retrieve carts by product ID" });
                });
        })
        .catch((error) => {
            const log = `${new Date().toISOString()} ERROR http://cart:3032/carts/product/${productId} CorrelationId: ${correlationId} [cart-service] - Failed to fetch product data from product service.`;
            publishLog(log);
            console.error("Error fetching product data:", error);
            res.status(500).json({ error: "Failed to fetch product data" });
        });
});


        // Delete product from cart
        app.delete("/carts/:cartId/products/:productId", jwtAuth, (req, res) => {
            const cartId = new ObjectId(req.params.cartId);
            const productId = req.params.productId;
            const correlationId = req.headers['x-correlation-id'] || new ObjectId().toString();

            const bearer = req.headers["authorization"];
            axios.defaults.headers.common['authorization'] = bearer;

            collection
                .findOneAndUpdate(
                    { _id: cartId },
                    { $pull: { products_id: productId } },
                    { returnOriginal: false }
                )
                .then((result) => {
                    if (result.value) {
                        const log = `${new Date().toISOString()} INFO http://cart:3032/carts/${cartId}/products/${productId} CorrelationId: ${correlationId} [cart-service] - Product deleted successfully from cart.`;
                        publishLog(log);
                        res.json({ message: "Product deleted successfully from cart" });

                        // Send statistics request to Heroku app
                        // axios.post('https://statistics-service-api.herokuapp.com/add-statistic', { service: "Cart", endpoint: "delete-product" })
                        axios.post('https://statistics-app-cc50d2934119.herokuapp.com/add-statistic', { service: "Cart", endpoint: "delete-product" })
                            .then(() => {
                                console.log("Statistics sent successfully.");
                            })
                            .catch((error) => {
                                console.error("Failed to send statistics:", error);
                            });

                    } else {
                        const log = `${new Date().toISOString()} ERROR http://cart:3032/carts/${cartId}/products/${productId} CorrelationId: ${correlationId} [cart-service] - Cart or product not found.`;
                        publishLog(log);
                        res.status(404).json({ error: "Cart or product not found" });
                    }
                })
                .catch((error) => {
                    const log = `${new Date().toISOString()} ERROR http://cart:3032/carts/${cartId}/products/${productId} CorrelationId: ${correlationId} [cart-service] - Failed to delete product from cart.`;
                    publishLog(log);
                    console.error("Error deleting product from cart:", error);
                    res.status(500).json({ error: "Failed to delete product from cart" });
                });
        });
        
        // Start the server
        const port = 3032; // Change to your desired port number
        const host = '0.0.0.0';
        app.listen(port, host, () => {
            console.log(`Server is running on ${host}:${port}`);
        });


    })
    .catch((error) => {
        console.error("Error connecting to MongoDB:", error);
    });
